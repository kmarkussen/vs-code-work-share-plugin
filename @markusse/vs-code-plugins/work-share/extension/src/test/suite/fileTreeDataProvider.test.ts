import * as assert from "assert";
import * as vscode from "vscode";
import { FileTreeDataProvider } from "../../fileTreeDataProvider";

function createMockEvent<T>(): vscode.Event<T> {
    return () => ({ dispose: () => {} });
}

suite("FileTreeDataProvider Test Suite", () => {
    test("Root should show connected status when no active files are returned", async () => {
        const apiClientStub = {
            getConnectionIssue: () => undefined,
            getFiles: async () => [],
            onDidChangeData: createMockEvent<void>(),
        } as const;

        const provider = new FileTreeDataProvider(apiClientStub as never);
        const rootItems = await provider.getChildren();

        const statusGroup = rootItems.find((item) => item.kind === "status-group");
        assert.ok(statusGroup, "Expected status section root item");
        const statusItems = await provider.getChildren(statusGroup);
        assert.ok(statusItems.some((item) => item.label === "Connection: Connected"));
        assert.ok(statusItems.some((item) => item.label === "Current User: Unknown user"));
        assert.ok(rootItems.some((item) => item.label === "No active files right now"));
    });

    test("Root should show status item when files fetch throws unexpectedly", async () => {
        const apiClientStub = {
            getConnectionIssue: () => undefined,
            getFiles: async () => {
                throw new Error("Unexpected payload parse error");
            },
            onDidChangeData: createMockEvent<void>(),
        } as const;

        const provider = new FileTreeDataProvider(apiClientStub as never);
        const rootItems = await provider.getChildren();

        assert.ok(rootItems.length > 0, "Expected at least one root item when fetch fails");
        assert.ok(
            rootItems.some((item) => item.label === "Failed to load file activity. Check Work Share API connection."),
        );
    });

    test("File node should show warning icon when tracker reports remote conflict", async () => {
        const apiClientStub = {
            getConnectionIssue: () => undefined,
            getFiles: async () => [
                {
                    repositoryRemoteUrl: "https://github.com/org/repo.git",
                    repositoryName: "repo",
                    fileCount: 1,
                    files: [
                        {
                            repositoryRemoteUrl: "https://github.com/org/repo.git",
                            repositoryFilePath: "src/example.ts",
                            repositoryFileName: "example.ts",
                            activeUsers: ["Alice"],
                            patches: [],
                            lastActivity: new Date("2026-03-08T12:00:00.000Z").toISOString(),
                        },
                    ],
                },
            ],
            onDidChangeData: createMockEvent<void>(),
        } as const;

        const trackerStub = {
            getProjectFileConflicts: (repositoryFilePath: string) => {
                const conflictMap = new Map([
                    [
                        "src/example.ts",
                        [
                            {
                                repositoryFilePath: "src/example.ts",
                                repositoryRemoteUrl: "https://github.com/org/repo.git",
                                userName: "Alice",
                                baseCommit: "abc123",
                                patch: "mock unified diff",
                                timestamp: new Date().toISOString(),
                            },
                        ],
                    ],
                ]);
                return conflictMap.get(repositoryFilePath);
            },
            onDidChangeConflictStatus: createMockEvent<void>(),
        };

        const provider = new FileTreeDataProvider(apiClientStub as never, trackerStub as never);
        const rootItems = await provider.getChildren();
        const repositoryItem = rootItems.find((item) => item.kind === "repository");
        assert.ok(repositoryItem, "Expected repository node");

        const repositoryChildren = await provider.getChildren(repositoryItem);
        assert.strictEqual(repositoryChildren.length, 1, "Expected one file node");
        assert.strictEqual(repositoryChildren[0].label, "example.ts");
        assert.strictEqual((repositoryChildren[0].iconPath as vscode.ThemeIcon).id, "warning");
    });

    test("Root should include connection and identity status section when tracker is available", async () => {
        const apiClientStub = {
            getConnectionIssue: () => undefined,
            getFiles: async () => [],
            onDidChangeData: createMockEvent<void>(),
        } as const;

        const trackerStub = {
            getCurrentUserName: async () => "Alice",
            isActivelySharingActivity: async () => true,
            getCurrentRemoteConflictAvailabilityIssue: async () =>
                "Remote conflict checks unavailable: repository is in detached HEAD state (no tracking branch).",
            onDidChangeConflictStatus: createMockEvent<void>(),
        };

        const provider = new FileTreeDataProvider(apiClientStub as never, trackerStub as never);
        const rootItems = await provider.getChildren();
        const statusGroup = rootItems.find((item) => item.kind === "status-group");
        assert.ok(statusGroup, "Expected status section root item");

        const statusItems = await provider.getChildren(statusGroup);
        assert.ok(statusItems.some((item) => item.label === "Connection: Connected"));
        assert.ok(statusItems.some((item) => item.label === "Current User: Alice"));
        assert.ok(
            statusItems.some(
                (item) =>
                    item.label ===
                    "Remote conflict checks unavailable: repository is in detached HEAD state (no tracking branch).",
            ),
        );
    });
});
