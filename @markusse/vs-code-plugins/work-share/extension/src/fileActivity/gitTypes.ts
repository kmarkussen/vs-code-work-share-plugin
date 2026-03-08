import * as vscode from "vscode";

export interface GitRemote {
    name: string;
    fetchUrl?: string;
    pushUrl?: string;
}

export interface GitRepository {
    rootUri: vscode.Uri;
    getConfig(key: string): Promise<string | undefined>;
    state?: {
        remotes?: GitRemote[];
    };
    /** Checks if a file path is ignored by git. */
    isIgnored(uri: vscode.Uri): Promise<boolean>;
}

export interface GitApi {
    repositories: GitRepository[];
}

export interface GitExtensionExports {
    getAPI(version: number): GitApi;
}
