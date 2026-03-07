export interface Activity {
    filePath: string;
    userName: string;
    timestamp: string;
    action: "open" | "edit" | "close";
    repositoryRemoteUrl: string;
}

export interface Patch {
    repositoryRemoteUrl: string;
    userName: string;
    repositoryFilePath: string;
    baseCommit: string;
    patch: string;
    timestamp: string;
}

export interface Repository {
    url: string;
    name: string;
    activityCount: number;
    patchCount: number;
    users: string[];
}

export interface UserData {
    name: string;
    repositories: string[];
    activityCount: number;
    patchCount: number;
    lastActivity: string;
}
