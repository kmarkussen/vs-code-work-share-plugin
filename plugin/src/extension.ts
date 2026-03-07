import * as vscode from "vscode";
import { FileActivityTracker } from "./fileActivityTracker";
import { ActivityTreeDataProvider } from "./activityTreeDataProvider";
import { ApiClient } from "./apiClient";

let fileActivityTracker: FileActivityTracker | undefined;

/**
 * Activates the Work Share extension and registers commands, tracking, and tree view wiring.
 */
export function activate(context: vscode.ExtensionContext) {
    console.log("Work Share extension is now active");

    // Initialize API client
    const apiClient = new ApiClient();

    // Initialize file activity tracker
    fileActivityTracker = new FileActivityTracker(context, apiClient);

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

    // Start tracking
    fileActivityTracker.start();

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("workShare")) {
                fileActivityTracker?.updateConfiguration();
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
