import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { createHash } from "crypto";
import { spawn } from "child_process";
import { ApiClient } from "./apiClient";
import { SharedPatch } from "./sharedPatch";
import { OutputLogger } from "./outputLogger";

/**
 * Returns true when the path points to a git internal file/directory.
 */
export function isGitInternalPath(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, "/");
    return normalizedPath.includes("/.git/") || normalizedPath.endsWith("/.git") || normalizedPath.endsWith(".git");
}

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

/**
 * Conflict prediction status for a repository-relative file.
 */
export type ConflictStatus = "clean" | "conflict" | "unknown";

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
    /** Checks if a file path is ignored by git. */
    isIgnored(uri: vscode.Uri): Promise<boolean>;
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
    private lastActiveEditorFilePath: string | undefined;
    private lastActiveEditorChangeAt = 0;
    private lastSharedPatchDigestByFile: Map<string, string> = new Map();

    constructor(
        private context: vscode.ExtensionContext,
        private apiClient: ApiClient,
        private logger?: OutputLogger,
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

    private getRepositoryRelativeFilePath(filePath: string): string | undefined {
        const repository = this.resolveRepositoryForFile(filePath);
        if (!repository) {
            return undefined;
        }

        return path.relative(repository.rootUri.fsPath, filePath).replace(/\\/g, "/");
    }

    private async resolveRepositoryByRemoteUrl(repositoryRemoteUrl: string): Promise<GitRepository | undefined> {
        await this.initializeGitContext();
        if (!this.gitApi) {
            return undefined;
        }

        for (const repository of this.gitApi.repositories) {
            const remoteUrl = await this.getRepositoryRemoteUrlForRepository(repository);
            if (remoteUrl === repositoryRemoteUrl) {
                return repository;
            }
        }

        return undefined;
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
     * Checks if a file is ignored by git to avoid tracking build artifacts, dependencies, etc.
     */
    private async isFileIgnoredByGit(filePath: string): Promise<boolean> {
        await this.initializeGitContext();
        const repository = this.resolveRepositoryForFile(filePath);
        if (!repository) {
            return false;
        }

        try {
            return await repository.isIgnored(vscode.Uri.file(filePath));
        } catch (error) {
            console.error("Failed to check if file is ignored:", error);
            return false;
        }
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
     * Determines whether a close event should be tracked as an active-editor close.
     */
    private shouldTrackCloseEvent(filePath: string): boolean {
        const activeEditorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (activeEditorPath === filePath) {
            return true;
        }

        // VS Code can update active editor immediately before close is emitted.
        return this.lastActiveEditorFilePath === filePath && Date.now() - this.lastActiveEditorChangeAt <= 500;
    }

    /**
     * Runs a git command in a target directory.
     */
    private async runGitCommand(
        workingDirectory: string,
        args: string[],
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        return new Promise((resolve, reject) => {
            const childProcess = spawn("git", args, {
                cwd: workingDirectory,
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";

            childProcess.stdout.on("data", (data: Buffer) => {
                stdout += data.toString();
            });

            childProcess.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
            });

            childProcess.on("error", reject);
            childProcess.on("close", (exitCode) => {
                resolve({
                    stdout,
                    stderr,
                    exitCode: exitCode ?? 1,
                });
            });
        });
    }

    /**
     * Generates and shares a repository-relative patch for a saved file.
     */
    private async sharePatchForFile(filePath: string): Promise<void> {
        if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))) {
            this.logger?.info("Patch sharing skipped: file is outside workspace.", { filePath });
            return;
        }

        if (isGitInternalPath(filePath) || (await this.isFileIgnoredByGit(filePath))) {
            this.logger?.info("Patch sharing skipped: file is git-internal or ignored.", { filePath });
            return;
        }

        const repository = this.resolveRepositoryForFile(filePath);
        if (!repository) {
            this.logger?.warn("Patch sharing skipped: no git repository resolved for file.", { filePath });
            return;
        }

        const repositoryRemoteUrl = await this.getRepositoryRemoteUrlForRepository(repository);
        if (!repositoryRemoteUrl) {
            this.logger?.warn("Patch sharing skipped: repository remote URL not found.", { filePath });
            return;
        }

        const repositoryFilePath = this.getRepositoryRelativeFilePath(filePath);
        if (!repositoryFilePath) {
            this.logger?.warn("Patch sharing skipped: unable to resolve repository-relative file path.", { filePath });
            return;
        }

        const repositoryRootPath = repository.rootUri.fsPath;
        const baseCommitResult = await this.runGitCommand(repositoryRootPath, ["rev-parse", "HEAD"]);
        if (baseCommitResult.exitCode !== 0) {
            this.logger?.error("Patch sharing failed: could not resolve base commit.", {
                filePath,
                stderr: baseCommitResult.stderr,
            });
            return;
        }

        const baseCommit = baseCommitResult.stdout.trim();
        const patchResult = await this.runGitCommand(repositoryRootPath, ["diff", "--", repositoryFilePath]);
        if (patchResult.exitCode !== 0) {
            this.logger?.error("Patch sharing failed: git diff command failed.", {
                filePath,
                repositoryFilePath,
                stderr: patchResult.stderr,
            });
            return;
        }

        const patchText = patchResult.stdout;
        if (!patchText.trim()) {
            this.logger?.info("Patch sharing skipped: no unstaged diff to share.", { repositoryFilePath });
            return;
        }

        const patchDigest = createHash("sha256").update(baseCommit).update("\n").update(patchText).digest("hex");

        if (this.lastSharedPatchDigestByFile.get(filePath) === patchDigest) {
            this.logger?.info("Patch sharing skipped: duplicate patch digest.", { repositoryFilePath });
            return;
        }

        this.lastSharedPatchDigestByFile.set(filePath, patchDigest);

        this.logger?.info("Patch generated for sharing.", {
            repositoryRemoteUrl,
            repositoryFilePath,
            baseCommit,
            patchLength: patchText.length,
            patchDigest,
        });

        await this.apiClient.sendPatch({
            repositoryRemoteUrl,
            userName: this.getUserName(),
            repositoryFilePath,
            baseCommit,
            patch: patchText,
            timestamp: new Date(),
        });
    }

    /**
     * Optionally checks conflicts after save based on user configuration.
     */
    private async autoCheckConflictsOnSave(filePath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration("workShare");
        const autoCheckEnabled = config.get<boolean>("autoCheckConflictsOnSave", false);
        if (!autoCheckEnabled) {
            return;
        }

        const status = await this.checkConflictStatusForFile(filePath);
        this.logger?.info("Auto conflict check on save completed.", { filePath, status });

        if (status === "conflict") {
            vscode.window.showWarningMessage("Work Share: Possible merge conflict detected for saved file.");
        }
    }

    /**
     * Checks whether an incoming patch conflicts with the current local working tree.
     */
    private async doesIncomingPatchConflict(repositoryRootPath: string, patch: SharedPatch): Promise<boolean> {
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "work-share-patch-"));
        const patchFilePath = path.join(tempDirectory, "incoming.patch");

        this.logger?.info("Conflict detector: checking incoming patch.", {
            repositoryFilePath: patch.repositoryFilePath,
            fromUser: patch.userName,
            baseCommit: patch.baseCommit,
        });

        try {
            await fs.writeFile(patchFilePath, patch.patch, "utf8");

            // Run a dry-run 3-way apply against the receiver's current working tree.
            // This reports conflicts with local edits without mutating files.
            const applyCheckResult = await this.runGitCommand(repositoryRootPath, [
                "apply",
                "--3way",
                "--check",
                patchFilePath,
            ]);

            this.logger?.info("Conflict detector: patch check completed.", {
                repositoryFilePath: patch.repositoryFilePath,
                fromUser: patch.userName,
                conflictDetected: applyCheckResult.exitCode !== 0,
                stderr: applyCheckResult.stderr,
            });

            return applyCheckResult.exitCode !== 0;
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    }

    /**
     * Evaluates conflict status for repository-relative files based on incoming patches.
     */
    public async getConflictStatusesForFiles(
        repositoryRemoteUrl: string | undefined,
        repositoryRelativeFilePaths: string[],
    ): Promise<Map<string, ConflictStatus>> {
        const statuses = new Map<string, ConflictStatus>();
        for (const filePath of repositoryRelativeFilePaths) {
            statuses.set(filePath, "clean");
        }

        if (!repositoryRemoteUrl || repositoryRelativeFilePaths.length === 0) {
            return statuses;
        }

        const repository = await this.resolveRepositoryByRemoteUrl(repositoryRemoteUrl);
        if (!repository) {
            for (const filePath of repositoryRelativeFilePaths) {
                statuses.set(filePath, "unknown");
            }

            return statuses;
        }

        const incomingPatches = await this.apiClient.getPatches({ repositoryRemoteUrl });
        const currentUserName = this.getUserName();
        const relevantPatches = incomingPatches.filter(
            (patch) =>
                patch.userName !== currentUserName && repositoryRelativeFilePaths.includes(patch.repositoryFilePath),
        );

        this.logger?.info("Conflict detector: evaluating incoming patches.", {
            repositoryRemoteUrl,
            currentUserName,
            totalIncomingPatches: incomingPatches.length,
            relevantIncomingPatches: relevantPatches.length,
            trackedFiles: repositoryRelativeFilePaths,
        });

        const patchesByFile = new Map<string, SharedPatch[]>();
        for (const patch of relevantPatches) {
            if (!patchesByFile.has(patch.repositoryFilePath)) {
                patchesByFile.set(patch.repositoryFilePath, []);
            }

            patchesByFile.get(patch.repositoryFilePath)!.push(patch);
        }

        for (const [repositoryFilePath, patches] of patchesByFile) {
            const sortedPatches = patches.sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());
            let hasConflict = false;

            for (const patch of sortedPatches.slice(0, 5)) {
                const conflicts = await this.doesIncomingPatchConflict(repository.rootUri.fsPath, patch);
                if (conflicts) {
                    hasConflict = true;
                    break;
                }
            }

            statuses.set(repositoryFilePath, hasConflict ? "conflict" : "clean");

            this.logger?.info("Conflict detector: file status computed.", {
                repositoryFilePath,
                evaluatedPatches: Math.min(sortedPatches.length, 5),
                status: hasConflict ? "conflict" : "clean",
            });
        }

        return statuses;
    }

    /**
     * Checks conflict status for a single absolute file path.
     */
    public async checkConflictStatusForFile(filePath: string): Promise<ConflictStatus> {
        const repositoryRemoteUrl = await this.getRepositoryRemoteUrl(filePath);
        const repositoryFilePath = this.getRepositoryRelativeFilePath(filePath);
        if (!repositoryFilePath) {
            return "unknown";
        }

        const statuses = await this.getConflictStatusesForFiles(repositoryRemoteUrl, [repositoryFilePath]);
        return statuses.get(repositoryFilePath) ?? "unknown";
    }

    /**
     * Checks conflict status across files referenced by incoming shared patches for the current repository.
     */
    public async checkProjectConflictStatuses(): Promise<{
        status: ConflictStatus;
        checkedFileCount: number;
        conflictFilePaths: string[];
    }> {
        const repositoryRemoteUrl = await this.getCurrentRepositoryRemoteUrl();
        if (!repositoryRemoteUrl) {
            this.logger?.warn("Project conflict check skipped: no active repository remote URL.");
            return {
                status: "unknown",
                checkedFileCount: 0,
                conflictFilePaths: [],
            };
        }

        const currentUserName = this.getUserName();
        const incomingPatches = await this.apiClient.getPatches({ repositoryRemoteUrl });
        const repositoryRelativeFilePaths = Array.from(
            new Set(
                incomingPatches
                    .filter((patch) => patch.userName !== currentUserName)
                    .map((patch) => patch.repositoryFilePath),
            ),
        );

        if (repositoryRelativeFilePaths.length === 0) {
            this.logger?.info("Project conflict check completed: no incoming files to evaluate.", {
                repositoryRemoteUrl,
            });
            return {
                status: "clean",
                checkedFileCount: 0,
                conflictFilePaths: [],
            };
        }

        const statuses = await this.getConflictStatusesForFiles(repositoryRemoteUrl, repositoryRelativeFilePaths);
        const conflictFilePaths = repositoryRelativeFilePaths.filter(
            (filePath) => statuses.get(filePath) === "conflict",
        );

        const status: ConflictStatus = conflictFilePaths.length > 0 ? "conflict" : "clean";
        this.logger?.info("Project conflict check completed.", {
            repositoryRemoteUrl,
            checkedFileCount: repositoryRelativeFilePaths.length,
            conflictCount: conflictFilePaths.length,
            conflictFilePaths,
        });

        return {
            status,
            checkedFileCount: repositoryRelativeFilePaths.length,
            conflictFilePaths,
        };
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

        this.lastActiveEditorFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
        this.lastActiveEditorChangeAt = Date.now();

        // Track file open events
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                this.lastActiveEditorFilePath = editor?.document.uri.fsPath;
                this.lastActiveEditorChangeAt = Date.now();
                if (editor) {
                    this.trackActivity(editor.document.uri.fsPath, "open");
                }
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

        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((document) => {
                void this.sharePatchForFile(document.uri.fsPath);
                void this.autoCheckConflictsOnSave(document.uri.fsPath);
            }),
        );

        // Track file close events
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                if (this.shouldTrackCloseEvent(doc.uri.fsPath)) {
                    this.trackActivity(doc.uri.fsPath, "close");
                }
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

        // Ignore files inside .git directory and git internal files
        if (isGitInternalPath(filePath)) {
            return;
        }

        // Ignore files that are in .gitignore
        if (await this.isFileIgnoredByGit(filePath)) {
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
