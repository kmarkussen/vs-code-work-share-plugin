import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { ApiClient } from "./apiClient";
import { SharedPatch } from "./sharedPatch";
import { OutputLogger } from "./outputLogger";
import { isGitInternalPath } from "./fileActivity/pathUtils";
import { ConflictStatus, FileActivity } from "./fileActivity/types";
import { GitContextService } from "./fileActivity/gitContext";
import { UserIdentityService } from "./fileActivity/identityService";
import { PatchSharingService } from "./fileActivity/patchSharingService";

export { isGitInternalPath } from "./fileActivity/pathUtils";
export type { ConflictStatus, FileActivity } from "./fileActivity/types";

/**
 * Tracks editor file events and reports repository-scoped activity to the server.
 */
export class FileActivityTracker {
    private disposables: vscode.Disposable[] = [];
    private activities: Map<string, FileActivity> = new Map();
    private updateTimer: NodeJS.Timeout | undefined;
    private lastActiveEditorFilePath: string | undefined;
    private lastActiveEditorChangeAt = 0;
    private gitContext: GitContextService;
    private identityService: UserIdentityService;
    private patchSharingService: PatchSharingService;

    constructor(
        private context: vscode.ExtensionContext,
        private apiClient: ApiClient,
        private logger?: OutputLogger,
    ) {
        this.gitContext = new GitContextService();
        this.identityService = new UserIdentityService(this.gitContext, logger);
        this.patchSharingService = new PatchSharingService(
            this.gitContext,
            this.identityService,
            this.apiClient,
            logger,
        );
        void this.identityService.initialize();
    }

    /**
     * Resolves the active repository remote URL used for filtering visible activity.
     */
    public async getCurrentRepositoryRemoteUrl(): Promise<string | undefined> {
        await this.gitContext.initialize();

        const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (activeFilePath) {
            return this.gitContext.getRepositoryRemoteUrl(activeFilePath);
        }

        const firstActivity = this.activities.values().next().value as FileActivity | undefined;
        if (firstActivity) {
            return firstActivity.repositoryRemoteUrl;
        }

        const workspaceRepository = this.gitContext.resolveWorkspaceRepository();
        if (workspaceRepository) {
            return this.gitContext.getRepositoryRemoteUrlForRepository(workspaceRepository);
        }

        return undefined;
    }

    /**
     * Returns the resolved current user identity used for activity and patch payloads.
     */
    public async getCurrentUserName(filePath?: string): Promise<string> {
        return this.identityService.getCurrentUserName(filePath);
    }

    /**
     * Gets the repository-relative file path for reveal operations in tree view.
     */
    public getRepositoryRelativeFilePath(filePath: string): string | undefined {
        return this.gitContext.getRepositoryRelativeFilePath(filePath);
    }
    /**
     * Determines if the user is actively sharing (identity resolved and no connection issues).
     * Used by the tree view to display sharing status icon.
     */
    public async isActivelySharingActivity(): Promise<boolean> {
        const identifiedName = await this.identityService.resolveIdentifiedUserName();
        return !!identifiedName;
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
            const applyCheckResult = await this.gitContext.runGitCommand(repositoryRootPath, [
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
        await this.identityService.getCurrentUserName();

        const statuses = new Map<string, ConflictStatus>();
        for (const filePath of repositoryRelativeFilePaths) {
            statuses.set(filePath, "clean");
        }

        if (!repositoryRemoteUrl || repositoryRelativeFilePaths.length === 0) {
            return statuses;
        }

        const repository = await this.gitContext.resolveRepositoryByRemoteUrl(repositoryRemoteUrl);
        if (!repository) {
            for (const filePath of repositoryRelativeFilePaths) {
                statuses.set(filePath, "unknown");
            }

            return statuses;
        }

        const incomingPatches = await this.apiClient.getPatches({ repositoryRemoteUrl });
        const currentUserName = await this.identityService.getCurrentUserName();
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
        const repositoryRemoteUrl = await this.gitContext.getRepositoryRemoteUrl(filePath);
        const repositoryFilePath = this.gitContext.getRepositoryRelativeFilePath(filePath);
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

        const currentUserName = await this.identityService.getCurrentUserName();
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
        const interval = config.get<number>("updateInterval", 5000);

        this.logger?.info("File activity tracker starting.", {
            enabled,
            updateInterval: interval,
        });

        if (!enabled) {
            this.logger?.warn("File activity tracker is disabled by configuration.");
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
                    void this.trackActivity(editor.document.uri.fsPath, "open");
                }
            }),
        );

        // Track file edit events
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.contentChanges.length > 0) {
                    void this.trackActivity(event.document.uri.fsPath, "edit");
                }
            }),
        );

        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((document) => {
                void this.patchSharingService.sharePatchForFile(document.uri.fsPath);
                void this.autoCheckConflictsOnSave(document.uri.fsPath);
            }),
        );

        // Track file close events
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                if (this.shouldTrackCloseEvent(doc.uri.fsPath)) {
                    void this.trackActivity(doc.uri.fsPath, "close");
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
            void this.sendActivitiesToServer();
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
        if (await this.gitContext.isFileIgnoredByGit(filePath)) {
            return;
        }

        const repositoryRemoteUrl = await this.gitContext.getRepositoryRemoteUrl(filePath);
        if (!repositoryRemoteUrl) {
            return;
        }

        const userName = await this.identityService.resolveIdentifiedUserName(filePath);
        if (!userName) {
            this.identityService.logIdentityBlockedActivity(filePath, action);
            return;
        }

        const activity: FileActivity = {
            filePath,
            userName,
            timestamp: new Date(),
            action,
            repositoryRemoteUrl,
        };

        this.activities.set(filePath, activity);
        this.logger?.info("Activity enqueued.", {
            filePath,
            action,
            userName,
            queueSize: this.activities.size,
        });
    }

    private async sendActivitiesToServer() {
        if (this.activities.size === 0) {
            return;
        }

        const activitiesToSend = Array.from(this.activities.values());
        this.logger?.info("Attempting to flush queued activities.", {
            count: activitiesToSend.length,
        });

        try {
            await this.apiClient.sendActivities(activitiesToSend);
            // Clear sent activities if close action
            for (const [pathKey, activity] of this.activities) {
                if (activity.action === "close") {
                    this.activities.delete(pathKey);
                }
            }
            this.logger?.info("Activity flush completed.", {
                sentCount: activitiesToSend.length,
                remainingQueueSize: this.activities.size,
            });
        } catch (error) {
            this.logger?.error("Activity flush failed.", {
                message: error instanceof Error ? error.message : String(error),
                attemptedCount: activitiesToSend.length,
            });
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
        this.identityService.resetWarnings();
        this.stop();
        this.start();
    }
}
