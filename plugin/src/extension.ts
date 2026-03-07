import * as vscode from "vscode";
import { FileActivityTracker } from "./fileActivityTracker";
import { ActivityTreeDataProvider } from "./activityTreeDataProvider";
import { ApiClient } from "./apiClient";
import { OutputLogger } from "./outputLogger";

let fileActivityTracker: FileActivityTracker | undefined;

/**
 * Activates the Work Share extension and registers commands, tracking, and tree view wiring.
 */
export function activate(context: vscode.ExtensionContext) {
    console.log("Work Share extension is now active");

    const outputChannel = vscode.window.createOutputChannel("Work Share");
    context.subscriptions.push(outputChannel);
    const logger = new OutputLogger(outputChannel);
    logger.info("Extension activated.");

    // Initialize API client
    const apiClient = new ApiClient(logger);

    // Initialize file activity tracker
    fileActivityTracker = new FileActivityTracker(context, apiClient, logger);

    // Initialize tree view provider
    const treeDataProvider = new ActivityTreeDataProvider(fileActivityTracker, apiClient);
    vscode.window.registerTreeDataProvider("workShareActivity", treeDataProvider);

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
        vscode.commands.registerCommand("work-share.checkActiveFileConflicts", async () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor || !fileActivityTracker) {
                vscode.window.showInformationMessage("Work Share: No active file to check.");
                return;
            }

            const status = await fileActivityTracker.checkConflictStatusForFile(activeEditor.document.uri.fsPath);
            if (status === "conflict") {
                vscode.window.showWarningMessage("Work Share: Possible merge conflict detected for active file.");
                return;
            }

            if (status === "clean") {
                vscode.window.showInformationMessage(
                    "Work Share: No incoming patch conflicts detected for active file.",
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
