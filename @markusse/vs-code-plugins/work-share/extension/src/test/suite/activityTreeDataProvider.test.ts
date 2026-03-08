import * as assert from "assert";
import * as vscode from "vscode";
import { ActivityTreeDataProvider } from "../../activityTreeDataProvider";

suite("ActivityTreeDataProvider Test Suite", () => {
    test("File nodes should show warning state for cached remote-tracking conflicts", async () => {
        const activity = {
            filePath: "/tmp/file.ts",
            userName: "Alice",
            timestamp: new Date("2026-03-08T12:00:00.000Z"),
            action: "open" as const,
            repositoryRemoteUrl: "https://github.com/org/repo.git",
        };

        const trackerStub = {
            getCurrentRepositoryRemoteUrl: async () => "https://github.com/org/repo.git",
            getActivities: async () => [activity],
            getCurrentUserName: async () => "Alice",
            isActivelySharingActivity: async () => true,
            getConflictStatusesForFiles: async () => new Map([["file.ts", "clean" as const]]),
            getKnownRemoteConflictStatus: () => "conflict" as const,
        };

        const apiClientStub = {
            getActivities: async () => [],
            getConnectionIssue: () => undefined,
        };

        const provider = new ActivityTreeDataProvider(trackerStub as never, apiClientStub as never);

        const rootItems = await provider.getChildren();
        const repositoryItem = rootItems.find((item) => item.label === "Repository: repo");
        assert.ok(repositoryItem, "Expected repository tree item");

        const userItems = await provider.getChildren(repositoryItem);
        const userItem = userItems.find((item) => item.label === "Alice (You)");
        assert.ok(userItem, "Expected current user tree item");

        const fileItems = await provider.getChildren(userItem);
        assert.strictEqual(fileItems.length, 1);
        assert.strictEqual(fileItems[0].label, "file.ts");
        assert.strictEqual(
            fileItems[0].tooltip?.toString(),
            "file.ts has possible merge conflicts from remote tracking branch updates.",
        );
        assert.strictEqual((fileItems[0].iconPath as vscode.ThemeIcon).id, "warning");
    });
});
