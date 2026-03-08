/**
 * Shared types for Work Share API.
 * Dashboard-specific types that extend or build upon the shared types.
 */

export {
    ActivityDto as Activity,
    PatchDto as Patch,
    RepositoryFilesInfo as RepositoryFiles,
    FileInfo as FileEditInfo,
    StoredPatch,
    GetActivitiesResponse,
    GetPatchesResponse,
    GetFilesResponse,
} from \"@work-share/types\";

/**
 * Dashboard-specific user data aggregation (not part of server API).
 */
export interface UserRecentActivity {
    type: "activity" | "patch";
    timestamp: string;
    userName: string;
    repositoryRemoteUrl: string;
    repositoryName: string;
    filePath: string;
    summary: string;
}

/**
 * Dashboard navigation target for focusing a repository file entry.
 */
export interface FileFocusTarget {
    repositoryRemoteUrl: string;
    filePath: string;
}

/**
 * Dashboard navigation target for focusing a patch entry.
 */
export interface PatchFocusTarget {
    repositoryRemoteUrl: string;
    filePath: string;
    timestamp: string;
    userName: string;
}

/**
 * Dashboard-specific user data aggregation (not part of server API).
 */
export interface UserData {
    name: string;
    repositories: string[];
    activityCount: number;
    patchCount: number;
    lastActivity: string;
    recentActivities: UserRecentActivity[];
}

/**
 * Dashboard-specific repository summary (computed from files data).
 */
export interface Repository {
    url: string;
    name: string;
    activityCount: number;
    patchCount: number;
    users: string[];
}
