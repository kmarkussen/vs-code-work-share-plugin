import * as assert from "assert";
import * as vscode from "vscode";
import {
    ConflictTreeDataProvider,
    FileTreeDataProvider,
    UserTreeDataProvider,
    WorkStatusDataProvider,
} from "../../fileTreeDataProvider";

function createMockEvent<T>(): vscode.Event<T> {
    return () => ({ dispose: () => {} });
}

suite("FileTreeDataProvider Test Suite", () => {
    test("WorkStatus root should include connection, user, repository, and upstream rows", async () => {
        const apiClientStub = {
            getConnectionIssue: () => undefined,
            onDidChangeData: createMockEvent<void>(),
        };

        const trackerStub = {
            getCurrentUserName: async () => "Alice",
            isActivelySharingActivity: async () => true,
            getCurrentRemoteConflictAvailabilityIssue: async () => undefined,
            getCurrentRepositoryRemoteUrl: async () => "https://github.com/org/repo.git",
            getUpstreamBranchForCurrentRepository: async () => "origin/main",
            onDidChangeConflictStatus: createMockEvent<void>(),
        };

        const provider = new WorkStatusDataProvider(apiClientStub as never, trackerStub as never);
        const root = await provider.getChildren();
        assert.strictEqual(root.length, 1);
        assert.strictEqual(root[0].kind, "status-group");

        const rows = await provider.getChildren(root[0]);
        const labels = rows.map((item) => String(item.label));
        assert.ok(labels.includes("Connection: Connected"));
        assert.ok(labels.includes("Current User: Alice"));
        assert.ok(labels.includes("Repository: repo"));
        assert.ok(labels.includes("Upstream: origin/main"));
    });

    test("WorkStatus should show warning when repository has no upstream", async () => {
        const apiClientStub = {
            getConnectionIssue: () => undefined,
            onDidChangeData: createMockEvent<void>(),
        };

        const trackerStub = {
            getCurrentUserName: async () => "Alice",
            isActivelySharingActivity: async () => true,
            getCurrentRemoteConflictAvailabilityIssue: async () => undefined,
            getCurrentRepositoryRemoteUrl: async () => "https://github.com/org/repo.git",
            getUpstreamBranchForCurrentRepository: async () => undefined,
            onDidChangeConflictStatus: createMockEvent<void>(),
        };

        const provider = new WorkStatusDataProvider(apiClientStub as never, trackerStub as never);
        const root = await provider.getChildren();
        const rows = await provider.getChildren(root[0]);
        assert.ok(rows.some((item) => item.label === "No upstream branch — run 'Select Upstream Branch'"));
    });

    test("ConflictTree should render file-first nodes with source children", async () => {
        const trackerStub = {
            getAllProjectFileConflicts: () =>
                new Map([
                    [
                        "src/example.ts",
                        [
                            {
                                repositoryRemoteUrl: "https://github.com/org/repo.git",
                                userName: "Bob",
                                repositoryFilePath: "src/example.ts",
                                baseCommit: "abc12345",
                                patch: "diff --git a/src/example.ts b/src/example.ts\n...",
                                timestamp: new Date("2026-03-10T10:00:00.000Z"),
                                changeType: "pending",
                                commitShortSha: "abc12345",
                                commitMessage: "Fix parser bug",
                                severity: "definite",
                            },
                        ],
                    ],
                ]),
            onDidChangeConflictStatus: createMockEvent<void>(),
        };

        const provider = new ConflictTreeDataProvider(trackerStub as never);
        const root = await provider.getChildren();
        assert.strictEqual(root.length, 1);
        assert.strictEqual(root[0].kind, "conflict-file");
        assert.strictEqual(String(root[0].label), "example.ts");

        const children = await provider.getChildren(root[0]);
        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].kind, "conflict-source");
        assert.ok(String(children[0].label).includes("Bob"));
    });

    test("UserTree should group patches by user then repo/branch", async () => {
        const apiClientStub = {
            getPatches: async () => [
                {
                    repositoryRemoteUrl: "https://github.com/org/repo.git",
                    userName: "Bob",
                    upstreamBranch: "origin/main",
                    repositoryFilePath: "src/features/a.ts",
                    baseCommit: "abc123",
                    patch: "diff --git a/src/features/a.ts b/src/features/a.ts\n...",
                    timestamp: new Date("2026-03-10T10:00:00.000Z"),
                    changeType: "pending",
                    commitShortSha: "abc123",
                    commitMessage: "Refactor parser",
                },
                {
                    repositoryRemoteUrl: "https://github.com/org/repo.git",
                    userName: "Bob",
                    upstreamBranch: "origin/main",
                    repositoryFilePath: "src/features/b.ts",
                    baseCommit: "abc123",
                    patch: "diff --git a/src/features/b.ts b/src/features/b.ts\n...",
                    timestamp: new Date("2026-03-10T10:01:00.000Z"),
                    changeType: "working",
                    workingState: "staged",
                },
                {
                    repositoryRemoteUrl: "https://github.com/org/repo.git",
                    userName: "Alice",
                    upstreamBranch: "origin/main",
                    repositoryFilePath: "src/self.ts",
                    baseCommit: "abc123",
                    patch: "diff --git a/src/self.ts b/src/self.ts\n...",
                    timestamp: new Date("2026-03-10T10:02:00.000Z"),
                    changeType: "working",
                    workingState: "unstaged",
                },
            ],
            onDidChangeData: createMockEvent<void>(),
        };

        const trackerStub = {
            getCurrentUserName: async () => "Alice",
            getCurrentRepositoryRemoteUrl: async () => "https://github.com/org/repo.git",
            onDidChangeConflictStatus: createMockEvent<void>(),
        };

        const provider = new UserTreeDataProvider(apiClientStub as never, trackerStub as never);

        const userRoots = await provider.getChildren();
        assert.strictEqual(userRoots.length, 1, "Current user entries should be filtered out");
        assert.strictEqual(String(userRoots[0].label), "Bob");

        const repoGroups = await provider.getChildren(userRoots[0]);
        assert.strictEqual(repoGroups.length, 1);
        assert.ok(String(repoGroups[0].label).includes("repo / origin/main"));

        const topLevelDirectories = await provider.getChildren(repoGroups[0]);
        assert.strictEqual(topLevelDirectories.length, 1);
        assert.strictEqual(topLevelDirectories[0].kind, "user-directory");
        assert.strictEqual(String(topLevelDirectories[0].label), "src/features");

        const patchLeaves = await provider.getChildren(topLevelDirectories[0]);
        assert.strictEqual(patchLeaves.length, 2);
        assert.ok(patchLeaves.some((item) => String(item.label).includes("Refactor parser")));
    });

    test("FileTree should show repository placeholders when API has active files but git list is empty", async () => {
        const apiClientStub = {
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
                            lastActivity: new Date("2026-03-10T10:00:00.000Z").toISOString(),
                        },
                    ],
                },
            ],
            onDidChangeData: createMockEvent<void>(),
        };

        const provider = new FileTreeDataProvider(apiClientStub as never, undefined, undefined);
        (provider as unknown as { gitContext: { getRepositories: () => Promise<unknown[]> } }).gitContext = {
            getRepositories: async () => [],
        };

        const root = await provider.getChildren();
        assert.strictEqual(root.length, 0, "No git repositories should produce no repository nodes");
    });
});
