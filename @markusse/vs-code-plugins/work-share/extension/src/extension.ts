import * as vscode from "vscode";
import { FileActivityTracker } from "./fileActivityTracker";
import { ApiClient } from "./apiClient";
import { OutputLogger } from "./outputLogger";
import { ConflictTreeDataProvider, FileTreeDataProvider, UserTreeDataProvider, WorkStatusDataProvider } from "./fileTreeDataProvider";

let fileActivityTracker: FileActivityTracker | undefined;

interface OpenConflictDiffArgs {
    patch: {
        repositoryRemoteUrl: string;
        userName: string;
        repositoryFilePath: string;
        baseCommit: string;
        patch: string;
        timestamp: string;
        committed?: boolean;
    };
    repositoryRemoteUrl?: string;
}

/**
 * Updates the context variable that controls toggle button icon visibility.
 */
async function updateTrackingContext(): Promise<void> {
    const config = vscode.workspace.getConfiguration("workShare");
    const enabled = config.get<boolean>("enabled", true);
    await vscode.commands.executeCommand("setContext", "workShare.isTrackingEnabled", enabled);
}

/**
 * Activates the Work Share extension and registers commands, tracking, and tree view wiring.
 */
export function activate(context: vscode.ExtensionContext) {
    console.log("Work Share extension is now active");

    const outputChannel = vscode.window.createOutputChannel("Work Share");
    context.subscriptions.push(outputChannel);
    const logger = new OutputLogger(outputChannel);
    logger.info("Extension activated.");

    // Set initial tracking context for menu visibility
    void updateTrackingContext();

    // Initialize API client
    const apiClient = new ApiClient(logger);

    // Initialize file activity tracker
    fileActivityTracker = new FileActivityTracker(context, apiClient, logger);

    // Initialize tree view provider
    const treeDataProvider = new FileTreeDataProvider(apiClient, fileActivityTracker, logger);
    const treeView = vscode.window.createTreeView("workShareActivity", {
        treeDataProvider: treeDataProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    const statusTreeDataProvider = new WorkStatusDataProvider(apiClient, fileActivityTracker, logger);
    const statusTreeView = vscode.window.createTreeView("workShareStatus", {
        treeDataProvider: statusTreeDataProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(statusTreeView);

    // Handle checkbox state changes for sharing status
    context.subscriptions.push(
        statusTreeView.onDidChangeCheckboxState((event) => {
            for (const [item] of event.items) {
                // Check if this is the sharing status item
                if (item && "kind" in item && item.kind === "sharing-status") {
                    // Execute toggle tracking command when checkbox state changes
                    void vscode.commands.executeCommand("work-share.toggleTracking");
                }
            }
        }),
    );

    // Auto-reveal active file when editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && treeView.visible && fileActivityTracker) {
                setTimeout(async () => {
                    const repoUrl = await fileActivityTracker!.getCurrentRepositoryRemoteUrl();
                    const repoPath = fileActivityTracker!.getRepositoryRelativeFilePath(editor.document.uri.fsPath);
                    if (repoPath && repoUrl) {
                        treeDataProvider.revealFileByPath(treeView, repoPath, repoUrl);
                    }
                }, 500);
            }
        }),
    );

    // Conflict tree view.
    const conflictTreeDataProvider = new ConflictTreeDataProvider(fileActivityTracker);
    const conflictTreeView = vscode.window.createTreeView("workShareConflicts", {
        treeDataProvider: conflictTreeDataProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(conflictTreeView);

    // User / team activity tree view.
    const userTreeDataProvider = new UserTreeDataProvider(apiClient, fileActivityTracker);
    const userTreeView = vscode.window.createTreeView("workShareUsers", {
        treeDataProvider: userTreeDataProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(userTreeView);

    // Reveal active file in conflict tree when editor focus changes.
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && conflictTreeView.visible && fileActivityTracker) {
                const repoPath = fileActivityTracker.getRepositoryRelativeFilePath(editor.document.uri.fsPath);
                if (repoPath) {
                    setTimeout(() => {
                        void conflictTreeDataProvider.revealFileByPath(conflictTreeView, repoPath);
                    }, 500);
                }
            }
        }),
    );

    // Reveal active file when tree view becomes visible
    context.subscriptions.push(
        treeView.onDidChangeVisibility((e) => {
            if (e.visible && vscode.window.activeTextEditor && fileActivityTracker) {
                setTimeout(async () => {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        const repoUrl = await fileActivityTracker!.getCurrentRepositoryRemoteUrl();
                        const repoPath = fileActivityTracker!.getRepositoryRelativeFilePath(editor.document.uri.fsPath);
                        if (repoPath && repoUrl) {
                            treeDataProvider.revealFileByPath(treeView, repoPath, repoUrl);
                        }
                    }
                }, 500);
            }
        }),
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.showFileActivity", () => {
            vscode.window.showInformationMessage("Work Share: Showing file activity");
            treeDataProvider.refresh();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.refreshView", () => {
            treeDataProvider.refresh();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.syncCurrentRepository", async () => {
            if (!fileActivityTracker) {
                vscode.window.showInformationMessage("Work Share: Sync coordinator is not available.");
                return;
            }

            await fileActivityTracker.syncCurrentRepository();
            vscode.window.showInformationMessage("Work Share: Current repository synchronized.");
            treeDataProvider.refresh();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.syncAllRepositories", async () => {
            if (!fileActivityTracker) {
                vscode.window.showInformationMessage("Work Share: Sync coordinator is not available.");
                return;
            }

            await fileActivityTracker.syncAllKnownRepositories();
            vscode.window.showInformationMessage("Work Share: All known repositories synchronized.");
            treeDataProvider.refresh();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.selectUpstreamBranch", async () => {
            if (!fileActivityTracker) {
                vscode.window.showInformationMessage("Work Share: Sync coordinator is not available.");
                return;
            }

            const selected = await fileActivityTracker.selectUpstreamBranchForCurrentRepository();
            if (selected) {
                vscode.window.showInformationMessage("Work Share: Upstream branch saved for this repository.");
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.openConflictDiff", async (args: OpenConflictDiffArgs) => {
            if (!fileActivityTracker || !args?.patch) {
                vscode.window.showWarningMessage("Work Share: Conflict details are unavailable for this item.");
                return;
            }

            await fileActivityTracker.openConflictInMergeEditor(
                {
                    ...args.patch,
                    timestamp: new Date(args.patch.timestamp),
                },
                args.repositoryRemoteUrl,
            );
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.configure", async () => {
            await vscode.commands.executeCommand("workbench.action.openSettings", "workShare");
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.toggleTracking", async () => {
            const config = vscode.workspace.getConfiguration("workShare");
            const currentlyEnabled = config.get<boolean>("enabled", true);
            await config.update("enabled", !currentlyEnabled, vscode.ConfigurationTarget.Global);

            // Update context immediately for responsive UI
            await updateTrackingContext();

            const newState = !currentlyEnabled ? "enabled" : "disabled";
            vscode.window.showInformationMessage(`Work Share: Tracking ${newState}.`);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.checkActiveFileConflicts", async () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor || !fileActivityTracker) {
                vscode.window.showInformationMessage("Work Share: No active file to check.");
                return;
            }

            const status = await fileActivityTracker.updateConflictStatusForFile(activeEditor.document.uri.fsPath);
            if (status === "conflict") {
                vscode.window.showWarningMessage(
                    "Work Share: Possible incoming or remote-tracking merge conflict detected for active file.",
                );
                return;
            }

            if (status === "clean") {
                vscode.window.showInformationMessage(
                    "Work Share: No incoming patch or remote-tracking conflicts detected for active file.",
                );
                return;
            }

            vscode.window.showInformationMessage("Work Share: Conflict status is unknown for active file.");
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("work-share.checkProjectConflicts", async () => {
            if (!fileActivityTracker) {
                vscode.window.showInformationMessage("Work Share: Conflict tracker is not available.");
                return;
            }

            const result = await fileActivityTracker.checkProjectConflictStatuses();
            if (result.status === "conflict") {
                vscode.window.showWarningMessage(
                    `Work Share: Possible merge conflicts detected in ${result.conflictFilePaths.length} file(s).`,
                );
                return;
            }

            if (result.status === "clean") {
                vscode.window.showInformationMessage(
                    `Work Share: No incoming patch conflicts detected across ${result.checkedFileCount} file(s).`,
                );
                return;
            }

            vscode.window.showInformationMessage("Work Share: Conflict status is unknown for project.");
        }),
    );

    // Start tracking
    fileActivityTracker.start();

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("workShare")) {
                apiClient.updateConfiguration();
                fileActivityTracker?.updateConfiguration();
                void updateTrackingContext();
                logger.info("Configuration updated.");
            }
        }),
    );
}

/**
 * Deactivates the extension and disposes background tracking.
 */
export function deactivate() {
    if (fileActivityTracker) {
        fileActivityTracker.stop();
    }
}
