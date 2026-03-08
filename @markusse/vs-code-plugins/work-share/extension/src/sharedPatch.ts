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
    /**
     * Optional flag to indicate if the patch represents committed changes from remote tracking branch.
     * When true, this patch represents conflicts from committed remote changes rather than from other users' work-in-progress patches.
     */
    committed?: boolean;
}
