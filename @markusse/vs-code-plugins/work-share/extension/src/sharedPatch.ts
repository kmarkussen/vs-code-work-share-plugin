/**
 * Shared patch model exchanged between extension clients via server API.
 */
export interface SharedPatch {
    repositoryRemoteUrl: string;
    userName: string;
    repositoryFilePath: string;
    baseCommit: string;
    patch: string;
    timestamp: Date;
    /** Optional classification used by latest-state patch storage on the server. */
    changeType?: "pending" | "working";
    /** Optional state for working changes. */
    workingState?: "staged" | "unstaged";
    /** Commit metadata for pending commit patches. */
    commitSha?: string;
    commitShortSha?: string;
    commitMessage?: string;
    /** Digest used for deduplication and stable change identity. */
    contentHash?: string;
    /**
     * Optional flag to indicate if the patch represents committed changes from remote tracking branch.
     * When true, this patch represents conflicts from committed remote changes rather than from other users' work-in-progress patches.
     */
    committed?: boolean;
}
