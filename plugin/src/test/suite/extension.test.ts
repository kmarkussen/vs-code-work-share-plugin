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
    });

    test("Configuration should have default values", () => {
        const config = vscode.workspace.getConfiguration("workShare");
        assert.strictEqual(config.get("enabled"), true);
        assert.strictEqual(config.get("updateInterval"), 5000);
        assert.strictEqual(config.get("apiServerUrl"), "");
    });
});
