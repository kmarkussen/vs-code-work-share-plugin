import * as assert from "assert";
import * as vscode from "vscode";

/**
 * Verifies extension activation wiring and default configuration contracts.
 */
suite("Extension Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests.");

    test("Extension should be present", () => {
        assert.ok(vscode.extensions.getExtension("undefined_publisher.work-share"));
    });

    test("Should register all commands", async () => {
        // Include internal commands so command registration checks are exhaustive.
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes("work-share.showFileActivity"));
        assert.ok(commands.includes("work-share.configure"));
        assert.ok(commands.includes("work-share.toggleTracking"));
        assert.ok(commands.includes("work-share.checkActiveFileConflicts"));
        assert.ok(commands.includes("work-share.checkProjectConflicts"));
    });

    test("Configuration should have default values", () => {
        const config = vscode.workspace.getConfiguration("workShare");
        assert.strictEqual(config.get("enabled"), true);
        assert.strictEqual(config.get("updateInterval"), 5000);
        assert.strictEqual(config.get("apiServerUrl"), "");
    });

    test("Toggle tracking command should change enabled state", async () => {
        const config = vscode.workspace.getConfiguration("workShare");

        // Get initial state
        const initialState = config.get<boolean>("enabled", true);

        // Execute toggle command
        await vscode.commands.executeCommand("work-share.toggleTracking");

        // Wait for configuration update to propagate
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify state changed
        const updatedConfig = vscode.workspace.getConfiguration("workShare");
        const newState = updatedConfig.get<boolean>("enabled", true);
        assert.strictEqual(newState, !initialState);

        // Toggle back to original state for cleanup
        await vscode.commands.executeCommand("work-share.toggleTracking");
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
});
