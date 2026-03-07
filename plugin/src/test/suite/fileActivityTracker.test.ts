import * as assert from "assert";
import { FileActivityTracker } from "../../fileActivityTracker";
import { ApiClient } from "../../apiClient";
import * as vscode from "vscode";

/**
 * Validates tracker lifecycle and baseline in-memory behavior.
 */
suite("FileActivityTracker Test Suite", () => {
    let tracker: FileActivityTracker;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        // Create a mock extension context
        mockContext = {
            subscriptions: [],
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => [],
            },
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => [],
                setKeysForSync: () => {},
            },
            extensionPath: "",
            extensionUri: vscode.Uri.file(""),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            environmentVariableCollection: {} as any,
            extensionMode: vscode.ExtensionMode.Test,
            storageUri: undefined,
            storagePath: undefined,
            globalStorageUri: vscode.Uri.file(""),
            globalStoragePath: "",
            logUri: vscode.Uri.file(""),
            logPath: "",
            asAbsolutePath: (relativePath: string) => relativePath,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            secrets: {} as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            extension: {} as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            languageModelAccessInformation: {} as any,
        } as vscode.ExtensionContext;

        // Use real client construction so tracker dependencies match production wiring.
        const apiClient = new ApiClient();
        tracker = new FileActivityTracker(mockContext, apiClient);
    });

    test("FileActivityTracker should initialize", () => {
        assert.ok(tracker);
    });

    test("FileActivityTracker should return empty activities initially", async () => {
        const activities = await tracker.getActivities();
        assert.strictEqual(activities.length, 0);
    });

    test("FileActivityTracker should start and stop without errors", () => {
        assert.doesNotThrow(() => {
            tracker.start();
            tracker.stop();
        });
    });
});
