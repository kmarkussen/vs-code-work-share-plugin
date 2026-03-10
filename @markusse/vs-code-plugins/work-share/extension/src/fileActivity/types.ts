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
 * Graduated conflict severity used by the rebase simulation engine.
 * - `none`: no conflicting hunks detected.
 * - `likely`: both sides modify nearby lines but merge is clean.
 * - `definite`: 3-way merge produces actual conflict markers.
 */
export type ConflictSeverity = "none" | "likely" | "definite";

/**
 * Standard output of a git command invocation.
 */
export interface GitCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
