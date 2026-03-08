import * as assert from "assert";
import { FileTreeDataProvider } from "../../fileTreeDataProvider";

suite("FileTreeDataProvider Test Suite", () => {
    test("Root should show connected status when no active files are returned", async () => {
        const apiClientStub = {
            getConnectionIssue: () => undefined,
            getFiles: async () => [],
        } as const;

        const provider = new FileTreeDataProvider(apiClientStub as never);
        const rootItems = await provider.getChildren();

        assert.strictEqual(rootItems.length, 2, "Expected connected status and empty placeholder items");
        assert.strictEqual(rootItems[0].label, "Connected to Work Share API");
        assert.strictEqual(rootItems[1].label, "No active files right now");
    });

    test("Root should show status item when files fetch throws unexpectedly", async () => {
        const apiClientStub = {
            getConnectionIssue: () => undefined,
            getFiles: async () => {
                throw new Error("Unexpected payload parse error");
            },
        } as const;

        const provider = new FileTreeDataProvider(apiClientStub as never);
        const rootItems = await provider.getChildren();

        assert.ok(rootItems.length > 0, "Expected at least one root item when fetch fails");
        assert.strictEqual(rootItems[0].label, "Failed to load file activity. Check Work Share API connection.");
    });
});
