import * as vscode from "vscode";
import { FileActivityTracker } from "./fileActivityTracker";
import { ApiClient } from "./apiClient";
import { OutputLogger } from "./outputLogger";
import { FileTreeDataProvider } from "./fileTreeDataProvider";

let fileActivityTracker: FileActivityTracker | undefined;

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
    const treeDataProvider = new FileTreeDataProvider(apiClient, logger);
    const treeView = vscode.window.createTreeView("workShareActivity", {
        treeDataProvider: treeDataProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

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

            const status = await fileActivityTracker.checkConflictStatusForFile(activeEditor.document.uri.fsPath);
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
