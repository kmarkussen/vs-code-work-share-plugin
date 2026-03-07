import * as vscode from "vscode";
import { ApiClient } from "./apiClient";

/**
 * Normalized activity payload used by the plugin and API client.
 */
export interface FileActivity {
    filePath: string;
    userName: string;
    timestamp: Date;
    action: "open" | "edit" | "close";
    /** Remote URL identifying the Git repository scope for the activity. */
    repositoryRemoteUrl: string;
}

interface GitRemote {
    name: string;
    fetchUrl?: string;
    pushUrl?: string;
}

interface GitRepository {
    rootUri: vscode.Uri;
    getConfig(key: string): Promise<string | undefined>;
    state?: {
        remotes?: GitRemote[];
    };
}

interface GitApi {
    repositories: GitRepository[];
}

interface GitExtensionExports {
    getAPI(version: number): GitApi;
}

/**
 * Tracks editor file events and reports repository-scoped activity to the server.
 */
export class FileActivityTracker {
    private disposables: vscode.Disposable[] = [];
    private activities: Map<string, FileActivity> = new Map();
    private updateTimer: NodeJS.Timeout | undefined;
    private gitUserName: string | undefined;
    private gitApi: GitApi | undefined;
    private gitInitializationPromise: Promise<void> | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private apiClient: ApiClient,
    ) {
        void this.initializeGitContext();
    }

    private async initializeGitContext(): Promise<void> {
        if (this.gitInitializationPromise) {
            return this.gitInitializationPromise;
        }

        this.gitInitializationPromise = (async () => {
            try {
                const gitExtension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
                if (!gitExtension) {
                    return;
                }

                if (!gitExtension.isActive) {
                    await gitExtension.activate();
                }

                const gitExports = gitExtension.exports;
                this.gitApi = gitExports.getAPI(1);
                if (this.gitApi.repositories.length > 0) {
                    await this.updateGitUserName(this.gitApi.repositories[0]);
                }
            } catch (error) {
                console.error("Failed to initialize git context:", error);
            }
        })();

        return this.gitInitializationPromise;
    }

    private async updateGitUserName(repository: GitRepository) {
        try {
            const config = await repository.getConfig("user.name");
            this.gitUserName = config;
        } catch (error) {
            console.error("Failed to get git user name:", error);
        }
    }

    private resolveRepositoryForFile(filePath: string): GitRepository | undefined {
        if (!this.gitApi || this.gitApi.repositories.length === 0) {
            return undefined;
        }

        // Match by repo root path prefix to support multi-root workspaces.
        const normalizedFilePath = filePath.replace(/\\/g, "/");
        return this.gitApi.repositories.find((repository) => {
            const repoPath = repository.rootUri.fsPath.replace(/\\/g, "/");
            return normalizedFilePath === repoPath || normalizedFilePath.startsWith(`${repoPath}/`);
        });
    }

    private async getRepositoryRemoteUrlForRepository(repository: GitRepository): Promise<string | undefined> {
        try {
            // Prefer canonical origin URL from git config when available.
            const remoteFromConfig = await repository.getConfig("remote.origin.url");
            if (remoteFromConfig) {
                return remoteFromConfig;
            }
        } catch (error) {
            console.error("Failed to read remote origin URL from git config:", error);
        }

        // Fallback to Git extension remote metadata.
        const originRemote = repository.state?.remotes?.find((remote) => remote.name === "origin");
        return originRemote?.fetchUrl ?? originRemote?.pushUrl;
    }

    private async getRepositoryRemoteUrl(filePath: string): Promise<string | undefined> {
        await this.initializeGitContext();
        const repository = this.resolveRepositoryForFile(filePath);
        if (!repository) {
            return undefined;
        }

        return this.getRepositoryRemoteUrlForRepository(repository);
    }

    private resolveWorkspaceRepository(): GitRepository | undefined {
        if (!this.gitApi || this.gitApi.repositories.length === 0) {
            return undefined;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        for (const workspaceFolder of workspaceFolders) {
            const workspacePath = workspaceFolder.uri.fsPath.replace(/\\/g, "/");
            const matchingRepository = this.gitApi.repositories.find((repository) => {
                const repositoryPath = repository.rootUri.fsPath.replace(/\\/g, "/");
                return repositoryPath === workspacePath || workspacePath.startsWith(`${repositoryPath}/`);
            });

            if (matchingRepository) {
                return matchingRepository;
            }
        }

        return this.gitApi.repositories[0];
    }

    /**
     * Resolves the active repository remote URL used for filtering visible activity.
     */
    public async getCurrentRepositoryRemoteUrl(): Promise<string | undefined> {
        await this.initializeGitContext();

        const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (activeFilePath) {
            return this.getRepositoryRemoteUrl(activeFilePath);
        }

        const firstActivity = this.activities.values().next().value as FileActivity | undefined;
        if (firstActivity) {
            return firstActivity.repositoryRemoteUrl;
        }

        const workspaceRepository = this.resolveWorkspaceRepository();
        if (workspaceRepository) {
            return this.getRepositoryRemoteUrlForRepository(workspaceRepository);
        }

        return undefined;
    }

    private getUserName(): string {
        const config = vscode.workspace.getConfiguration("workShare");
        const configuredName = config.get<string>("userName");

        if (configuredName) {
            return configuredName;
        }

        if (this.gitUserName) {
            return this.gitUserName;
        }

        return "Unknown User";
    }

    /**
     * Starts event subscriptions and background send timer.
     */
    public start() {
        const config = vscode.workspace.getConfiguration("workShare");
        const enabled = config.get<boolean>("enabled", true);

        if (!enabled) {
            return;
        }

        // Track file open events
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                this.trackActivity(doc.uri.fsPath, "open");
            }),
        );

        // Track file edit events
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.contentChanges.length > 0) {
                    this.trackActivity(event.document.uri.fsPath, "edit");
                }
            }),
        );

        // Track file close events
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                this.trackActivity(doc.uri.fsPath, "close");
            }),
        );

        // Start periodic update timer
        this.startUpdateTimer();
    }

    /**
     * Stops event subscriptions and pending timers.
     */
    public stop() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];

        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = undefined;
        }
    }

    private startUpdateTimer() {
        const config = vscode.workspace.getConfiguration("workShare");
        const interval = config.get<number>("updateInterval", 5000);

        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        this.updateTimer = setInterval(() => {
            this.sendActivitiesToServer();
        }, interval);
    }

    private async trackActivity(filePath: string, action: "open" | "edit" | "close") {
        // Ignore non-workspace files
        if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))) {
            return;
        }

        const repositoryRemoteUrl = await this.getRepositoryRemoteUrl(filePath);
        if (!repositoryRemoteUrl) {
            return;
        }

        const activity: FileActivity = {
            filePath,
            userName: this.getUserName(),
            timestamp: new Date(),
            action,
            repositoryRemoteUrl,
        };

        this.activities.set(filePath, activity);
    }

    private async sendActivitiesToServer() {
        if (this.activities.size === 0) {
            return;
        }

        const activitiesToSend = Array.from(this.activities.values());

        try {
            await this.apiClient.sendActivities(activitiesToSend);
            // Clear sent activities if close action
            for (const [path, activity] of this.activities) {
                if (activity.action === "close") {
                    this.activities.delete(path);
                }
            }
        } catch (error) {
            console.error("Failed to send activities to server:", error);
        }
    }

    /**
     * Returns locally tracked activities scoped to the currently active repository.
     */
    public async getActivities(): Promise<FileActivity[]> {
        const currentRepositoryRemoteUrl = await this.getCurrentRepositoryRemoteUrl();
        const allActivities = Array.from(this.activities.values());

        if (!currentRepositoryRemoteUrl) {
            return allActivities;
        }

        return allActivities.filter((activity) => activity.repositoryRemoteUrl === currentRepositoryRemoteUrl);
    }

    /**
     * Restarts tracker state to apply latest configuration values.
     */
    public updateConfiguration() {
        this.stop();
        this.start();
    }
}
