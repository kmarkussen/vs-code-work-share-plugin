/**
 * File lifecycle action tracked by the extension.
 */
export type FileActivityAction = "open" | "edit" | "close";

/**
 * Normalized activity payload used by the plugin and API client.
 */
export interface FileActivity {
    filePath: string;
    userName: string;
    timestamp: Date;
    action: FileActivityAction;
    /** Remote URL identifying the Git repository scope for the activity. */
    repositoryRemoteUrl: string;
}

/**
 * Conflict prediction status for a repository-relative file.
 */
export type ConflictStatus = "clean" | "conflict" | "unknown";

/**
 * Standard output of a git command invocation.
 */
export interface GitCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
