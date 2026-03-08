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
    repositoryFilePath: string;
    baseCommit: string;
    patch: string;
    timestamp: string;
}

interface PatchSyncRequest {
    repositoryRemoteUrl: string;
    userName: string;
    patches: PatchSyncItem[];
}

// Keep in-memory state at module scope so it persists even if controller instances are recreated per request.
const activityStore: Map<string, StoredActivity[]> = new Map();
const patchStore: Map<string, StoredPatch[]> = new Map();

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
    allActivities: StoredActivity[],
): string[] {
    const fileActivities = allActivities.filter(
        (a) => a.repositoryRemoteUrl === repositoryRemoteUrl && a.filePath === repositoryFilePath,
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
    allActivities: StoredActivity[],
): string {
    const fileActivities = allActivities.filter(
        (a) => a.repositoryRemoteUrl === repositoryRemoteUrl && a.filePath === repositoryFilePath,
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
    getFiles(@QueryParam("repositoryRemoteUrl") repositoryRemoteUrl?: string): GetFilesResponse {
        const allActivities = Array.from(activityStore.values()).flat();
        const allPatches = Array.from(patchStore.values()).flat();

        // Collect unique files with active users
        const filesMap = new Map<string, FileInfo>();

        for (const activity of allActivities) {
            const fileKey = `${activity.repositoryRemoteUrl}:${activity.filePath}`;
            if (!filesMap.has(fileKey)) {
                const activeUsers = getActiveUsersForFile(
                    activity.repositoryRemoteUrl,
                    activity.filePath,
                    allActivities,
                );

                // Only include files that have active users
                if (activeUsers.length > 0) {
                    const patches = allPatches.filter(
                        (p) =>
                            p.repositoryRemoteUrl === activity.repositoryRemoteUrl &&
                            pathsReferToSameFile(p.repositoryFilePath, activity.filePath),
                    );

                    // Prefer the repository-relative patch path when one exists so the dashboard shows stable paths.
                    const displayPath = patches[0]?.repositoryFilePath ?? activity.filePath;

                    filesMap.set(fileKey, {
                        repositoryRemoteUrl: activity.repositoryRemoteUrl,
                        repositoryFilePath: displayPath,
                        repositoryFileName: extractFileName(displayPath),
                        activeUsers,
                        patchCount: patches.length,
                        patches,
                        lastActivity: getLastActivityTimestamp(
                            activity.repositoryRemoteUrl,
                            activity.filePath,
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

            const repoUrl = fileInfo.repositoryRemoteUrl;
            if (!reposMap.has(repoUrl)) {
                reposMap.set(repoUrl, {
                    repositoryRemoteUrl: repoUrl,
                    repositoryName: extractRepositoryName(repoUrl),
                    fileCount: 0,
                    files: [],
                });
            }

            reposMap.get(repoUrl)!.files.push(fileInfo);
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
     * Returns shared patches, optionally filtered by repository, file, and user.
     */
    @Get("/patches")
    getPatches(
        @QueryParam("repositoryRemoteUrl") repositoryRemoteUrl?: string,
        @QueryParam("repositoryFilePath") repositoryFilePath?: string,
        @QueryParam("userName") userName?: string,
    ): GetPatchesResponse {
        let patches = Array.from(patchStore.values()).flat();

        if (repositoryRemoteUrl) {
            patches = patches.filter((patch) => patch.repositoryRemoteUrl === repositoryRemoteUrl);
        }

        if (repositoryFilePath) {
            patches = patches.filter((patch) => patch.repositoryFilePath === repositoryFilePath);
        }

        if (userName) {
            patches = patches.filter((patch) => patch.userName === userName);
        }

        patches.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

        const response: GetPatchesResponse = {
            count: patches.length,
            patches,
        };
        return response;
    }

    /**
     * Receives a generated git patch and stores it in memory.
     */
    @Post("/patches")
    async receivePatch(@Body() patch: PatchDto): Promise<PostPatchesResponse> {
        const normalizedUserName = normalizeAndValidateIdentity(patch.userName);
        const key = `${patch.repositoryRemoteUrl}:${patch.repositoryFilePath}`;
        if (!patchStore.has(key)) {
            patchStore.set(key, []);
        }

        const records = patchStore.get(key)!;
        const existingPatch = records.find(
            (record) =>
                record.userName === patch.userName &&
                record.baseCommit === patch.baseCommit &&
                record.patch === patch.patch,
        );

        if (!existingPatch) {
            records.push({
                ...patch,
                userName: normalizedUserName,
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                receivedAt: new Date().toISOString(),
            });
        }

        // Keep most recent records per file key to avoid unbounded memory usage.
        if (records.length > 200) {
            records.splice(0, records.length - 200);
        }

        const response: PostPatchesResponse = {
            success: true,
            message: "Patch stored",
            timestamp: new Date().toISOString(),
        };
        return response;
    }

    /**
     * Replaces all previously uploaded patches for a user/repository with the currently active patch list.
     */
    @Post("/patches/sync")
    async synchronizePatches(@Body() body: PatchSyncRequest): Promise<PostPatchesResponse> {
        if (!body?.repositoryRemoteUrl?.trim()) {
            throw new BadRequestError("repositoryRemoteUrl is required.");
        }

        const normalizedUserName = normalizeAndValidateIdentity(body.userName);
        const synchronizedPatches = Array.isArray(body.patches) ? body.patches : [];

        let removedCount = 0;
        for (const [fileKey, records] of patchStore.entries()) {
            const retainedRecords = records.filter(
                (record) =>
                    !(
                        record.repositoryRemoteUrl === body.repositoryRemoteUrl &&
                        record.userName === normalizedUserName
                    ),
            );
            removedCount += records.length - retainedRecords.length;

            if (retainedRecords.length === 0) {
                patchStore.delete(fileKey);
            } else {
                patchStore.set(fileKey, retainedRecords);
            }
        }

        let createdCount = 0;
        for (const patch of synchronizedPatches) {
            if (!patch.repositoryFilePath?.trim() || !patch.baseCommit?.trim() || !patch.patch?.trim()) {
                continue;
            }

            const key = `${body.repositoryRemoteUrl}:${patch.repositoryFilePath}`;
            if (!patchStore.has(key)) {
                patchStore.set(key, []);
            }

            patchStore.get(key)!.push({
                repositoryRemoteUrl: body.repositoryRemoteUrl,
                userName: normalizedUserName,
                repositoryFilePath: patch.repositoryFilePath,
                baseCommit: patch.baseCommit,
                patch: patch.patch,
                timestamp: patch.timestamp,
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                receivedAt: new Date().toISOString(),
            });
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
    ): GetActivitiesResponse {
        let activities = Array.from(activityStore.values()).flat();

        if (repositoryRemoteUrl) {
            activities = activities.filter((activity) => activity.repositoryRemoteUrl === repositoryRemoteUrl);
        }

        if (userName) {
            activities = activities.filter((activity) => activity.userName === userName);
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

            // Partition by repository + user + file so each stream is independently append-only.
            const key = `${activity.repositoryRemoteUrl}:${normalizedUserName}:${activity.filePath}`;

            if (!activityStore.has(key)) {
                activityStore.set(key, []);
            }

            activityStore.get(key)!.push({
                ...activity,
                userName: normalizedUserName,
                receivedAt: new Date().toISOString(),
            });

            console.log(
                `[${activity.timestamp}] ${activity.userName} ${activity.action} ${activity.filePath} (${activity.repositoryRemoteUrl})`,
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
