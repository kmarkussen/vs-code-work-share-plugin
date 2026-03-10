import { Activity, Patch, RepositoryFiles, StoredPatch } from "./types";

export interface DashboardMetric {
    label: string;
    value: string;
    detail: string;
}

export interface DashboardUserSummary {
    name: string;
    repositoryCount: number;
    fileCount: number;
    activityCount: number;
    patchCount: number;
    lastSeen: string;
    topRepository: string;
}

export interface DashboardRepositorySummary {
    repositoryRemoteUrl: string;
    repositoryName: string;
    upstreamBranch?: string;
    fileCount: number;
    activeUserCount: number;
    patchCount: number;
    lastActivity: string;
}

export interface RepositoryTreeNode {
    repositoryRemoteUrl: string;
    repositoryName: string;
    upstreamBranch?: string;
    fileCount: number;
    patchCount: number;
    files: RepositoryFileNode[];
}

export interface RepositoryFileNode {
    repositoryFilePath: string;
    repositoryFileName: string;
    activeUsers: string[];
    patchCount: number;
    lastActivity: string;
    patches: StoredPatch[];
}

export interface ActivityFeedItem {
    id: string;
    type: "activity" | "patch";
    timestamp: string;
    userName: string;
    repositoryRemoteUrl: string;
    repositoryName: string;
    filePath: string;
    title: string;
    detail: string;
}

export interface FeaturedPatch {
    id: string;
    patch: Patch;
    repositoryName: string;
    fileName: string;
    relativeTime: string;
    variantLabel: string;
}

export function extractRepoName(url: string): string {
    const normalized = url.replace(/\.git$/, "");
    const segments = normalized.split("/").filter((segment) => segment.length > 0);
    return segments[segments.length - 1] || url;
}

export function extractFileName(filePath: string): string {
    const segments = filePath.split("/").filter((segment) => segment.length > 0);
    return segments[segments.length - 1] || filePath;
}

export function formatRelativeTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) {
        return "Just now";
    }
    if (diffMins < 60) {
        return `${diffMins}m ago`;
    }

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
        return `${diffDays}d ago`;
    }

    return date.toLocaleDateString();
}

export function buildDashboardMetrics(
    activities: Activity[],
    patches: Patch[],
    repositories: RepositoryFiles[],
): DashboardMetric[] {
    const userNames = new Set<string>();
    activities.forEach((activity) => userNames.add(activity.userName));
    patches.forEach((patch) => userNames.add(patch.userName));

    const changedFiles = new Set<string>();
    repositories.forEach((repository) => {
        repository.files.forEach((file: RepositoryFiles["files"][number]) =>
            changedFiles.add(`${repository.repositoryRemoteUrl}:${file.repositoryFilePath}`),
        );
    });

    const pendingCommits = patches.filter((patch) => patch.changeType === "pending").length;
    const workingChanges = patches.filter((patch) => patch.changeType === "working").length;

    return [
        {
            label: "Active repositories",
            value: String(repositories.length),
            detail: "Repositories currently represented in the server state.",
        },
        {
            label: "People contributing",
            value: String(userNames.size),
            detail: "Distinct identities visible across activity and patch streams.",
        },
        {
            label: "Tracked files",
            value: String(changedFiles.size),
            detail: "Repository files with active editors or shared patch state.",
        },
        {
            label: "Pending vs working",
            value: `${pendingCommits}/${workingChanges}`,
            detail: "Pending commits vs staged/unstaged working changes currently shared.",
        },
    ];
}

export function buildUserSummaries(
    activities: Activity[],
    patches: Patch[],
    repositories: RepositoryFiles[],
): DashboardUserSummary[] {
    const userMap = new Map<
        string,
        {
            repositories: Set<string>;
            files: Set<string>;
            activityCount: number;
            patchCount: number;
            lastSeen: string;
            repoFrequency: Map<string, number>;
        }
    >();

    for (const activity of activities) {
        const existing = userMap.get(activity.userName) ?? {
            repositories: new Set<string>(),
            files: new Set<string>(),
            activityCount: 0,
            patchCount: 0,
            lastSeen: activity.timestamp,
            repoFrequency: new Map<string, number>(),
        };

        const repositoryName = extractRepoName(activity.repositoryRemoteUrl);
        existing.repositories.add(repositoryName);
        existing.files.add(`${activity.repositoryRemoteUrl}:${activity.filePath}`);
        existing.activityCount += 1;
        existing.lastSeen = maxTimestamp(existing.lastSeen, activity.timestamp);
        existing.repoFrequency.set(repositoryName, (existing.repoFrequency.get(repositoryName) ?? 0) + 1);
        userMap.set(activity.userName, existing);
    }

    for (const patch of patches) {
        const existing = userMap.get(patch.userName) ?? {
            repositories: new Set<string>(),
            files: new Set<string>(),
            activityCount: 0,
            patchCount: 0,
            lastSeen: patch.timestamp,
            repoFrequency: new Map<string, number>(),
        };

        const repositoryName = extractRepoName(patch.repositoryRemoteUrl);
        existing.repositories.add(repositoryName);
        existing.files.add(`${patch.repositoryRemoteUrl}:${patch.repositoryFilePath}`);
        existing.patchCount += 1;
        existing.lastSeen = maxTimestamp(existing.lastSeen, patch.timestamp);
        existing.repoFrequency.set(repositoryName, (existing.repoFrequency.get(repositoryName) ?? 0) + 1);
        userMap.set(patch.userName, existing);
    }

    for (const repository of repositories) {
        for (const file of repository.files) {
            for (const userName of file.activeUsers) {
                const existing = userMap.get(userName) ?? {
                    repositories: new Set<string>(),
                    files: new Set<string>(),
                    activityCount: 0,
                    patchCount: 0,
                    lastSeen: file.lastActivity,
                    repoFrequency: new Map<string, number>(),
                };

                existing.repositories.add(repository.repositoryName);
                existing.files.add(`${repository.repositoryRemoteUrl}:${file.repositoryFilePath}`);
                existing.lastSeen = maxTimestamp(existing.lastSeen, file.lastActivity);
                existing.repoFrequency.set(
                    repository.repositoryName,
                    (existing.repoFrequency.get(repository.repositoryName) ?? 0) + 1,
                );
                userMap.set(userName, existing);
            }
        }
    }

    return Array.from(userMap.entries())
        .map(([name, value]) => ({
            name,
            repositoryCount: value.repositories.size,
            fileCount: value.files.size,
            activityCount: value.activityCount,
            patchCount: value.patchCount,
            lastSeen: value.lastSeen,
            topRepository: pickTopRepository(value.repoFrequency),
        }))
        .sort((left, right) => new Date(right.lastSeen).getTime() - new Date(left.lastSeen).getTime());
}

export function buildRepositorySummaries(repositories: RepositoryFiles[]): DashboardRepositorySummary[] {
    return repositories
        .map((repository) => {
            const activeUsers = new Set<string>();
            let patchCount = 0;
            let lastActivity = "";

            for (const file of repository.files) {
                for (const user of file.activeUsers) {
                    activeUsers.add(user);
                }
                patchCount += file.patchCount;
                lastActivity = maxTimestamp(lastActivity, file.lastActivity);
            }

            return {
                repositoryRemoteUrl: repository.repositoryRemoteUrl,
                repositoryName: repository.repositoryName,
                upstreamBranch: repository.upstreamBranch,
                fileCount: repository.fileCount,
                activeUserCount: activeUsers.size,
                patchCount,
                lastActivity,
            };
        })
        .sort((left, right) => new Date(right.lastActivity).getTime() - new Date(left.lastActivity).getTime());
}

export function buildRepositoryTree(repositories: RepositoryFiles[]): RepositoryTreeNode[] {
    return repositories
        .map((repository) => ({
            repositoryRemoteUrl: repository.repositoryRemoteUrl,
            repositoryName: repository.repositoryName,
            upstreamBranch: repository.upstreamBranch,
            fileCount: repository.fileCount,
            patchCount: repository.files.reduce(
                (sum: number, file: RepositoryFiles["files"][number]) => sum + file.patchCount,
                0,
            ),
            files: [...repository.files]
                .sort((left, right) => new Date(right.lastActivity).getTime() - new Date(left.lastActivity).getTime())
                .map((file) => ({
                    repositoryFilePath: file.repositoryFilePath,
                    repositoryFileName: file.repositoryFileName,
                    activeUsers: file.activeUsers,
                    patchCount: file.patchCount,
                    lastActivity: file.lastActivity,
                    patches: file.patches,
                })),
        }))
        .sort(
            (left, right) =>
                right.patchCount - left.patchCount || left.repositoryName.localeCompare(right.repositoryName),
        );
}

export function buildFeaturedPatches(patches: Patch[]): FeaturedPatch[] {
    return [...patches]
        .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
        .map((patch, index) => ({
            id: `${patch.repositoryRemoteUrl}:${patch.repositoryFilePath}:${patch.userName}:${patch.timestamp}:${index}`,
            patch,
            repositoryName: extractRepoName(patch.repositoryRemoteUrl),
            fileName: extractFileName(patch.repositoryFilePath),
            relativeTime: formatRelativeTime(patch.timestamp),
            variantLabel:
                patch.changeType === "pending" ?
                    `Pending commit${patch.commitShortSha ? ` ${patch.commitShortSha}` : ""}`
                :   `${patch.workingState ?? "working"} change`,
        }));
}

export function buildActivityFeed(activities: Activity[], patches: Patch[]): ActivityFeedItem[] {
    const activityItems: ActivityFeedItem[] = activities.map((activity, index) => ({
        id: `activity-${index}-${activity.timestamp}-${activity.filePath}`,
        type: "activity",
        timestamp: activity.timestamp,
        userName: activity.userName,
        repositoryRemoteUrl: activity.repositoryRemoteUrl,
        repositoryName: extractRepoName(activity.repositoryRemoteUrl),
        filePath: activity.filePath,
        title: `${activity.userName} ${formatAction(activity.action)} ${extractFileName(activity.filePath)}`,
        detail: `${extractRepoName(activity.repositoryRemoteUrl)} · ${activity.filePath}`,
    }));

    const patchItems: ActivityFeedItem[] = patches.map((patch, index) => ({
        id: `patch-${index}-${patch.timestamp}-${patch.repositoryFilePath}`,
        type: "patch",
        timestamp: patch.timestamp,
        userName: patch.userName,
        repositoryRemoteUrl: patch.repositoryRemoteUrl,
        repositoryName: extractRepoName(patch.repositoryRemoteUrl),
        filePath: patch.repositoryFilePath,
        title: buildPatchTitle(patch),
        detail: `${extractRepoName(patch.repositoryRemoteUrl)} · ${patch.repositoryFilePath}`,
    }));

    return [...activityItems, ...patchItems].sort(
        (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
    );
}

function buildPatchTitle(patch: Patch): string {
    if (patch.changeType === "pending") {
        const sha = patch.commitShortSha ?? patch.commitSha?.slice(0, 8) ?? patch.baseCommit.slice(0, 8);
        return `${patch.userName} pushed pending commit ${sha}${patch.commitMessage ? ` · ${patch.commitMessage}` : ""}`;
    }

    if (patch.changeType === "working") {
        return `${patch.userName} shared ${patch.workingState ?? "working"} changes for ${extractFileName(patch.repositoryFilePath)}`;
    }

    return `${patch.userName} shared a patch for ${extractFileName(patch.repositoryFilePath)}`;
}

function pickTopRepository(repositoryFrequency: Map<string, number>): string {
    let topRepository = "";
    let highestCount = -1;

    for (const [repository, count] of repositoryFrequency.entries()) {
        if (count > highestCount) {
            topRepository = repository;
            highestCount = count;
        }
    }

    return topRepository;
}

function maxTimestamp(left: string, right: string): string {
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }
    return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function formatAction(action: Activity["action"]): string {
    switch (action) {
        case "open":
            return "opened";
        case "edit":
            return "edited";
        case "close":
            return "closed";
        default:
            return action;
    }
}
