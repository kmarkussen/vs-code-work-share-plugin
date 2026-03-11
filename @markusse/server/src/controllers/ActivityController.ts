import { JsonController, Post, Body, Get, QueryParam, BadRequestError } from "routing-controllers";
import {
    ActivityBatchDto,
    ActivityDto,
    PatchDto,
    StoredPatch,
    FileInfo,
    RepositoryFilesInfo,
    GetFilesResponse,
    GetActivitiesResponse,
    GetPatchesResponse,
    PostActivitiesResponse,
    PostPatchesResponse,
} from "@work-share/types";

/**
 * Stored activity extends wire payload with server ingestion timestamp.
 */
interface StoredActivity extends ActivityDto {
    receivedAt: string;
}

interface PatchSyncItem {
    repositoryRemoteUrl?: string;
    userName?: string;
    upstreamBranch?: string;
    repositoryFilePath: string;
    baseCommit: string;
    patch: string;
    timestamp: string | Date;
    committed?: boolean;
}

interface PatchSyncRequest {
    repositoryRemoteUrl?: string;
    userName?: string;
    upstreamBranch?: string;
    patches: PatchSyncItem[];
}

/**
 * Normalizes optional branch values so filters and grouping behave consistently.
 */
function normalizeUpstreamBranch(upstreamBranch: string | undefined): string | undefined {
    const normalized = upstreamBranch?.trim();
    return normalized ? normalized : undefined;
}

/**
 * Normalizes sync timestamp values to ISO format for server persistence.
 */
function normalizeSyncTimestamp(timestamp: string | Date | undefined): string {
    if (timestamp instanceof Date) {
        return timestamp.toISOString();
    }

    if (typeof timestamp === "string" && timestamp.trim()) {
        return timestamp;
    }

    return new Date().toISOString();
}

// Keep in-memory state at module scope so it persists even if controller instances are recreated per request.
const activityStore: Map<string, StoredActivity[]> = new Map();

/**
 * Latest-state-only patch storage.
 * Key format: `${repositoryRemoteUrl}:${branch}:${userName}:${filePath}:${changeType}:${workingState || ""}:${commitSha || ""}`
 * Each key maps to exactly one patch (the latest submission for that composite identity).
 */
const patchStore: Map<string, StoredPatch> = new Map();

/**
 * Validates caller identity and rejects ambiguous placeholders.
 */
function normalizeAndValidateIdentity(userName: string): string {
    const normalizedUserName = userName.trim();
    const normalizedLower = normalizedUserName.toLowerCase();
    if (!normalizedUserName || normalizedLower === "unknown user" || normalizedLower === "unknown") {
        throw new BadRequestError("Client identity is required. Configure workShare.userName or git user.name.");
    }

    return normalizedUserName;
}

/**
 * Creates a composite key for latest-state-only patch storage.
 * Includes changeType, workingState, and commitSha to distinguish patches.
 */
function createPatchCompositeKey(patch: StoredPatch | PatchDto): string {
    const normalizedBranch = normalizeUpstreamBranch(patch.upstreamBranch) ?? "";
    const changeType = (patch as any).changeType || "working";
    const workingState = (patch as any).workingState || "";
    const commitSha = (patch as any).commitSha || "";
    return `${patch.repositoryRemoteUrl}:${normalizedBranch}:${patch.userName}:${patch.repositoryFilePath}:${changeType}:${workingState}:${commitSha}`;
}

/**
 * Extracts repository name from remote URL.
 */
function extractRepositoryName(url: string): string {
    const normalized = url.replace(/\.git$/, "");
    const segments = normalized.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1] || url;
}

/**
 * Extracts file name from repository-relative path.
 */
function extractFileName(repositoryFilePath: string): string {
    const segments = repositoryFilePath.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1] || repositoryFilePath;
}

/**
 * Normalizes a file path so absolute editor paths and repository-relative patch paths can be compared.
 */
function normalizeComparablePath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

/**
 * Determines whether two file path representations point to the same repository file.
 */
function pathsReferToSameFile(left: string, right: string): boolean {
    const normalizedLeft = normalizeComparablePath(left);
    const normalizedRight = normalizeComparablePath(right);

    return (
        normalizedLeft === normalizedRight ||
        normalizedLeft.endsWith(`/${normalizedRight}`) ||
        normalizedRight.endsWith(`/${normalizedLeft}`)
    );
}

/**
 * Determines which users are currently editing a file based on activity history.
 * Users are "active" if they have an "edit" or "open" action without a subsequent "close".
 */
function getActiveUsersForFile(
    repositoryRemoteUrl: string,
    repositoryFilePath: string,
    upstreamBranch: string | undefined,
    allActivities: StoredActivity[],
): string[] {
    const fileActivities = allActivities.filter(
        (a) =>
            a.repositoryRemoteUrl === repositoryRemoteUrl &&
            a.filePath === repositoryFilePath &&
            normalizeUpstreamBranch(a.upstreamBranch) === normalizeUpstreamBranch(upstreamBranch),
    );

    // Map users to their most recent action
    const userLastAction = new Map<string, { action: string; timestamp: string }>();
    for (const activity of fileActivities.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
        userLastAction.set(activity.userName, {
            action: activity.action,
            timestamp: activity.timestamp,
        });
    }

    // Users are active if their last action is "open" or "edit"
    const activeUsers = Array.from(userLastAction.entries())
        .filter(([, { action }]) => action === "open" || action === "edit")
        .map(([user]) => user);

    return activeUsers;
}

/**
 * Gets the most recent activity timestamp for a file.
 */
function getLastActivityTimestamp(
    repositoryRemoteUrl: string,
    repositoryFilePath: string,
    upstreamBranch: string | undefined,
    allActivities: StoredActivity[],
): string {
    const fileActivities = allActivities.filter(
        (a) =>
            a.repositoryRemoteUrl === repositoryRemoteUrl &&
            a.filePath === repositoryFilePath &&
            normalizeUpstreamBranch(a.upstreamBranch) === normalizeUpstreamBranch(upstreamBranch),
    );

    if (fileActivities.length === 0) {
        return new Date().toISOString();
    }

    return fileActivities.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0].timestamp;
}

/**
 * Handles ingestion and querying of repository-scoped file activity.
 */
@JsonController()
export class ActivityController {
    /**
     * Returns files organized by repository, with active users and associated patches.
     * Only includes files that currently have active editors.
     */
    @Get("/files")
    getFiles(
        @QueryParam("repositoryRemoteUrl") repositoryRemoteUrl?: string,
        @QueryParam("upstreamBranch") upstreamBranch?: string,
    ): GetFilesResponse {
        const allActivities = Array.from(activityStore.values()).flat();
        const allPatches = Array.from(patchStore.values());
        const normalizedFilterBranch = normalizeUpstreamBranch(upstreamBranch);

        // Collect unique files with active users
        const filesMap = new Map<string, FileInfo>();

        for (const activity of allActivities) {
            const activityBranch = normalizeUpstreamBranch(activity.upstreamBranch);
            if (normalizedFilterBranch !== undefined && activityBranch !== normalizedFilterBranch) {
                continue;
            }

            const fileKey = `${activity.repositoryRemoteUrl}:${activityBranch ?? ""}:${activity.filePath}`;
            if (!filesMap.has(fileKey)) {
                const activeUsers = getActiveUsersForFile(
                    activity.repositoryRemoteUrl,
                    activity.filePath,
                    activityBranch,
                    allActivities,
                );

                // Only include files that have active users
                if (activeUsers.length > 0) {
                    const patches = allPatches.filter(
                        (p) =>
                            p.repositoryRemoteUrl === activity.repositoryRemoteUrl &&
                            normalizeUpstreamBranch(p.upstreamBranch) === activityBranch &&
                            pathsReferToSameFile(p.repositoryFilePath, activity.filePath),
                    );

                    // Prefer the repository-relative patch path when one exists so the dashboard shows stable paths.
                    const displayPath = patches[0]?.repositoryFilePath ?? activity.filePath;

                    filesMap.set(fileKey, {
                        repositoryRemoteUrl: activity.repositoryRemoteUrl,
                        upstreamBranch: activityBranch,
                        repositoryFilePath: displayPath,
                        repositoryFileName: extractFileName(displayPath),
                        activeUsers,
                        patchCount: patches.length,
                        patches,
                        lastActivity: getLastActivityTimestamp(
                            activity.repositoryRemoteUrl,
                            activity.filePath,
                            activityBranch,
                            allActivities,
                        ),
                    });
                }
            }
        }

        // Group files by repository
        const reposMap = new Map<string, RepositoryFilesInfo>();

        for (const fileInfo of filesMap.values()) {
            if (repositoryRemoteUrl && fileInfo.repositoryRemoteUrl !== repositoryRemoteUrl) {
                continue;
            }

            const repoKey = `${fileInfo.repositoryRemoteUrl}:${normalizeUpstreamBranch(fileInfo.upstreamBranch) ?? ""}`;
            if (!reposMap.has(repoKey)) {
                reposMap.set(repoKey, {
                    repositoryRemoteUrl: fileInfo.repositoryRemoteUrl,
                    upstreamBranch: fileInfo.upstreamBranch,
                    repositoryName: extractRepositoryName(fileInfo.repositoryRemoteUrl),
                    fileCount: 0,
                    files: [],
                });
            }

            reposMap.get(repoKey)!.files.push(fileInfo);
        }

        // Sort files by last activity timestamp (newest first)
        for (const repo of reposMap.values()) {
            repo.files.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
            repo.fileCount = repo.files.length;
        }

        const repositories = Array.from(reposMap.values());

        const response: GetFilesResponse = {
            count: repositories.length,
            repositories,
        };
        return response;
    }

    /**
     * Returns shared patches, optionally filtered by repository, file, user, and branch.
     * Returns latest-state-only patches (one per composite key).
     */
    @Get("/patches")
    getPatches(
        @QueryParam("repositoryRemoteUrl") repositoryRemoteUrl?: string,
        @QueryParam("repositoryFilePath") repositoryFilePath?: string,
        @QueryParam("userName") userName?: string,
        @QueryParam("upstreamBranch") upstreamBranch?: string,
    ): GetPatchesResponse {
        let patches = Array.from(patchStore.values());
        const normalizedFilterBranch = normalizeUpstreamBranch(upstreamBranch);

        if (repositoryRemoteUrl) {
            patches = patches.filter((patch) => patch.repositoryRemoteUrl === repositoryRemoteUrl);
        }

        if (repositoryFilePath) {
            patches = patches.filter((patch) => patch.repositoryFilePath === repositoryFilePath);
        }

        if (userName) {
            patches = patches.filter((patch) => patch.userName === userName);
        }

        if (normalizedFilterBranch !== undefined) {
            patches = patches.filter(
                (patch) => normalizeUpstreamBranch(patch.upstreamBranch) === normalizedFilterBranch,
            );
        }

        patches.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

        const response: GetPatchesResponse = {
            count: patches.length,
            patches,
        };
        return response;
    }

    /**
     * Receives a generated git patch and stores it using latest-state-only model.
     * Each composite key (repo+branch+user+file+changeType+workingState+commitSha) maps to one patch.
     */
    @Post("/patches")
    async receivePatch(@Body() patch: PatchDto): Promise<PostPatchesResponse> {
        const normalizedUserName = normalizeAndValidateIdentity(patch.userName);
        const normalizedUpstreamBranch = normalizeUpstreamBranch(patch.upstreamBranch);

        const storedPatch: StoredPatch = {
            ...patch,
            userName: normalizedUserName,
            upstreamBranch: normalizedUpstreamBranch,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            receivedAt: new Date().toISOString(),
        };

        const compositeKey = createPatchCompositeKey(storedPatch);
        patchStore.set(compositeKey, storedPatch);

        const response: PostPatchesResponse = {
            success: true,
            message: "Patch stored (latest-state-only)",
            timestamp: new Date().toISOString(),
        };
        return response;
    }

    /**
     * Replaces all previously uploaded patches for a user/repository/branch with the currently active patch list.
     * Uses latest-state-only model: each composite key receives exactly one patch per sync.
     */
    @Post("/patches/sync")
    async synchronizePatches(@Body() body: PatchSyncRequest): Promise<PostPatchesResponse> {
        const synchronizedPatches = Array.isArray(body?.patches) ? body.patches : [];
        const resolvedRepositoryRemoteUrl =
            body?.repositoryRemoteUrl?.trim() ||
            synchronizedPatches.find((patch) => patch.repositoryRemoteUrl)?.repositoryRemoteUrl?.trim();

        if (!resolvedRepositoryRemoteUrl) {
            throw new BadRequestError("repositoryRemoteUrl is required (request-level or patch item-level).");
        }

        const resolvedUserName =
            body?.userName?.trim() || synchronizedPatches.find((patch) => patch.userName)?.userName?.trim();
        const normalizedRequestBranch = normalizeUpstreamBranch(body?.upstreamBranch);

        if (!resolvedUserName) {
            throw new BadRequestError("userName is required (request-level or patch item-level).");
        }

        const normalizedUserName = normalizeAndValidateIdentity(resolvedUserName);

        // Remove all patches matching this user/repository/branch scope
        let removedCount = 0;
        for (const compositeKey of Array.from(patchStore.keys())) {
            const patch = patchStore.get(compositeKey)!;
            if (
                patch.repositoryRemoteUrl === resolvedRepositoryRemoteUrl &&
                patch.userName === normalizedUserName &&
                (normalizedRequestBranch === undefined ||
                    normalizeUpstreamBranch(patch.upstreamBranch) === normalizedRequestBranch)
            ) {
                patchStore.delete(compositeKey);
                removedCount += 1;
            }
        }

        // Add all new patches using latest-state-only composite keys
        let createdCount = 0;
        for (const patch of synchronizedPatches) {
            if (!patch.repositoryFilePath?.trim() || !patch.baseCommit?.trim() || !patch.patch?.trim()) {
                continue;
            }

            const patchRepositoryRemoteUrl = patch.repositoryRemoteUrl?.trim() || resolvedRepositoryRemoteUrl;
            const patchUserName = patch.userName?.trim() || normalizedUserName;
            const patchUpstreamBranch = normalizeUpstreamBranch(patch.upstreamBranch) ?? normalizedRequestBranch;
            if (!patchRepositoryRemoteUrl || !patchUserName) {
                continue;
            }

            const storedPatch: StoredPatch = {
                repositoryRemoteUrl: patchRepositoryRemoteUrl,
                userName: patchUserName,
                upstreamBranch: patchUpstreamBranch,
                repositoryFilePath: patch.repositoryFilePath,
                baseCommit: patch.baseCommit,
                patch: patch.patch,
                timestamp: normalizeSyncTimestamp(patch.timestamp),
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                receivedAt: new Date().toISOString(),
                ...((patch as any).changeType && { changeType: (patch as any).changeType }),
                ...((patch as any).workingState && { workingState: (patch as any).workingState }),
                ...((patch as any).commitSha && { commitSha: (patch as any).commitSha }),
                ...((patch as any).commitShortSha && { commitShortSha: (patch as any).commitShortSha }),
                ...((patch as any).commitMessage && { commitMessage: (patch as any).commitMessage }),
                ...((patch as any).contentHash && { contentHash: (patch as any).contentHash }),
            };

            const compositeKey = createPatchCompositeKey(storedPatch);
            patchStore.set(compositeKey, storedPatch);
            createdCount += 1;
        }

        const response: PostPatchesResponse = {
            success: true,
            message: `Patches synchronized (removed ${removedCount}, created ${createdCount})`,
            timestamp: new Date().toISOString(),
        };
        return response;
    }

    /**
     * Returns stored activities, optionally filtered by repository and user.
     */
    @Get("/activities")
    getActivities(
        @QueryParam("repositoryRemoteUrl") repositoryRemoteUrl?: string,
        @QueryParam("userName") userName?: string,
        @QueryParam("upstreamBranch") upstreamBranch?: string,
    ): GetActivitiesResponse {
        let activities = Array.from(activityStore.values()).flat();
        const normalizedFilterBranch = normalizeUpstreamBranch(upstreamBranch);

        if (repositoryRemoteUrl) {
            activities = activities.filter((activity) => activity.repositoryRemoteUrl === repositoryRemoteUrl);
        }

        if (userName) {
            activities = activities.filter((activity) => activity.userName === userName);
        }

        if (normalizedFilterBranch !== undefined) {
            activities = activities.filter(
                (activity) => normalizeUpstreamBranch(activity.upstreamBranch) === normalizedFilterBranch,
            );
        }

        const response: GetActivitiesResponse = {
            count: activities.length,
            activities,
        };
        return response;
    }

    /**
     * Ingests activity events from plugin clients and stores them in memory.
     */
    @Post("/activities")
    async receiveActivities(@Body() body: ActivityBatchDto): Promise<PostActivitiesResponse> {
        console.log(`Received ${body.activities.length} activities`);

        // Process each activity
        body.activities.forEach((activity) => {
            const normalizedUserName = normalizeAndValidateIdentity(activity.userName);
            const normalizedUpstreamBranch = normalizeUpstreamBranch(activity.upstreamBranch);

            // Partition by repository + user + file so each stream is independently append-only.
            const key = `${activity.repositoryRemoteUrl}:${normalizedUpstreamBranch ?? ""}:${normalizedUserName}:${activity.filePath}`;

            if (!activityStore.has(key)) {
                activityStore.set(key, []);
            }

            activityStore.get(key)!.push({
                ...activity,
                userName: normalizedUserName,
                upstreamBranch: normalizedUpstreamBranch,
                receivedAt: new Date().toISOString(),
            });

            console.log(
                `[${activity.timestamp}] ${activity.userName} ${activity.action} ${activity.filePath} (${activity.repositoryRemoteUrl}${normalizedUpstreamBranch ? ` @ ${normalizedUpstreamBranch}` : ""})`,
            );
        });

        const response: PostActivitiesResponse = {
            success: true,
            message: `Processed ${body.activities.length} activities`,
            timestamp: new Date().toISOString(),
        };
        return response;
    }

    /**
     * Clears all stored activities and patches.
     * This method is intended for testing purposes only.
     */
    static clearStores(): void {
        activityStore.clear();
        patchStore.clear();
    }
}
