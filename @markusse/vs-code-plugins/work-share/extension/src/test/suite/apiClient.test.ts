import * as assert from "assert";
import { ApiClient } from "../../apiClient";

/**
 * Validates API client behavior in minimal/no-config test environments.
 */
suite("ApiClient Test Suite", () => {
    test("ApiClient should initialize without errors", () => {
        const client = new ApiClient();
        assert.ok(client);
    });

    test("ApiClient should handle missing configuration gracefully", async () => {
        const client = new ApiClient();
        // Should not throw when API URL is not configured
        await assert.doesNotReject(async () => {
            await client.sendActivities([]);
        });
    });
});
