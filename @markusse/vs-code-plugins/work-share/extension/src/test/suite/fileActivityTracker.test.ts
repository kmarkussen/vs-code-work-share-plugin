import * as assert from "assert";
import { FileActivityTracker, isGitInternalPath } from "../../fileActivityTracker";
import { ApiClient } from "../../apiClient";
import * as vscode from "vscode";

/**
 * Validates tracker lifecycle and baseline in-memory behavior.
 */
suite("FileActivityTracker Test Suite", () => {
    let tracker: FileActivityTracker;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
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

        const apiClient = new ApiClient();
        tracker = new FileActivityTracker(mockContext, apiClient);
    });

    teardown(() => {
        tracker.stop();
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

    test("FileActivityTracker should be instantiated without throwing", () => {
        const apiClient = new ApiClient();
        const newTracker = new FileActivityTracker(mockContext, apiClient);
        assert.ok(newTracker);
        newTracker.stop();
    });

    test("FileActivityTracker configuration update should not throw", () => {
        assert.doesNotThrow(() => {
            tracker.updateConfiguration();
        });
    });

    test("FileActivityTracker should handle getCurrentRepositoryRemoteUrl without active repo", async () => {
        const remoteUrl = await tracker.getCurrentRepositoryRemoteUrl();
        // In test environment without git, this may return undefined
        assert.ok(remoteUrl === undefined || typeof remoteUrl === "string");
    });

    test("checkConflictStatusForFile should report conflict when remote tracking branch conflicts", async () => {
        const trackerInternals = tracker as unknown as {
            gitContext: {
                getRepositoryRemoteUrl(filePath: string): Promise<string | undefined>;
                getRepositoryRelativeFilePath(filePath: string): string | undefined;
            };
            evaluatePatchConflictsForFile(
                repositoryRemoteUrl: string | undefined,
                repositoryFilePath: string,
            ): Promise<import("../../sharedPatch").SharedPatch[]>;
            evaluateRemoteTrackingConflictStatusForFile(
                filePath: string,
                options?: { forceRefresh?: boolean },
            ): Promise<import("../../sharedPatch").SharedPatch | undefined>;
        };

        trackerInternals.gitContext.getRepositoryRemoteUrl = async () => "https://github.com/org/repo.git";
        trackerInternals.gitContext.getRepositoryRelativeFilePath = () => "src/example.ts";
        trackerInternals.evaluatePatchConflictsForFile = async () => [];
        trackerInternals.evaluateRemoteTrackingConflictStatusForFile = async () => ({
            repositoryRemoteUrl: "https://github.com/org/repo.git",
            userName: "origin/main",
            repositoryFilePath: "src/example.ts",
            baseCommit: "abc123",
            patch: "diff content",
            timestamp: new Date(),
            committed: true,
        });

        const status = await tracker.updateConflictStatusForFile("/repo/src/example.ts");
        assert.strictEqual(status, "conflict");
    });

    test("checkConflictStatusForFile should stay clean when both patch and remote checks are clean", async () => {
        const trackerInternals = tracker as unknown as {
            gitContext: {
                getRepositoryRemoteUrl(filePath: string): Promise<string | undefined>;
                getRepositoryRelativeFilePath(filePath: string): string | undefined;
            };
            evaluatePatchConflictsForFile(
                repositoryRemoteUrl: string | undefined,
                repositoryFilePath: string,
            ): Promise<import("../../sharedPatch").SharedPatch[]>;
            evaluateRemoteTrackingConflictStatusForFile(
                filePath: string,
                options?: { forceRefresh?: boolean },
            ): Promise<import("../../sharedPatch").SharedPatch | undefined>;
        };

        trackerInternals.gitContext.getRepositoryRemoteUrl = async () => "https://github.com/org/repo.git";
        trackerInternals.gitContext.getRepositoryRelativeFilePath = () => "src/example.ts";
        trackerInternals.evaluatePatchConflictsForFile = async () => [];
        trackerInternals.evaluateRemoteTrackingConflictStatusForFile = async () => undefined;

        const status = await tracker.updateConflictStatusForFile("/repo/src/example.ts");
        assert.strictEqual(status, "clean");
    });

    test("isGitInternalPath should detect .git directory files", () => {
        assert.strictEqual(isGitInternalPath("/repo/.git/config"), true);
        assert.strictEqual(isGitInternalPath("/repo/.git/index"), true);
        assert.strictEqual(isGitInternalPath("C:/repo/.git/HEAD"), true);
    });

    test("isGitInternalPath should detect trailing .git filenames", () => {
        assert.strictEqual(isGitInternalPath("/repo/package-lock.json.git"), true);
        assert.strictEqual(isGitInternalPath("/repo/something.git"), true);
    });

    test("isGitInternalPath should ignore normal project files", () => {
        assert.strictEqual(isGitInternalPath("/repo/package-lock.json"), false);
        assert.strictEqual(isGitInternalPath("/repo/src/file.ts"), false);
    });
});
