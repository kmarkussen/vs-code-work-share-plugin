import * as assert from "assert";
import * as vscode from "vscode";
import { ApiClient } from "../../apiClient";
import { FileActivity } from "../../fileActivity/types";

/**
 * Validates API client behavior in minimal/no-config test environments.
 */
suite("ApiClient Test Suite", () => {
    const sampleActivity: FileActivity = {
        filePath: "/repo/src/example.ts",
        userName: "alice",
        timestamp: new Date("2026-03-11T10:00:00.000Z"),
        action: "edit",
        repositoryRemoteUrl: "https://github.com/org/repo.git",
    };

    let originalFetch: typeof fetch;
    let originalApiServerUrl: string | undefined;
    let fetchCalls: Array<{ url: string; init?: RequestInit }>;

    suiteSetup(async () => {
        originalFetch = globalThis.fetch;
        originalApiServerUrl = vscode.workspace.getConfiguration("workShare").get<string>("apiServerUrl");
    });

    setup(async () => {
        fetchCalls = [];
        await vscode.workspace
            .getConfiguration("workShare")
            .update("apiServerUrl", "http://work-share.test", vscode.ConfigurationTarget.Global);
    });

    teardown(async () => {
        globalThis.fetch = originalFetch;
        await vscode.workspace
            .getConfiguration("workShare")
            .update("apiServerUrl", originalApiServerUrl ?? "", vscode.ConfigurationTarget.Global);
    });

    function installFetchMock(handler: (url: string, init?: RequestInit) => Promise<Response> | Response): void {
        globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url =
                typeof input === "string" ? input
                : input instanceof URL ? input.toString()
                : input.url;

            fetchCalls.push({ url, init });
            return handler(url, init);
        };
    }

    function jsonResponse(status: number, body: unknown): Response {
        const headers = new Headers();
        headers.set("content-type", "application/json");

        return new Response(JSON.stringify(body), {
            status,
            headers,
        });
    }

    test("ApiClient should initialize without errors", () => {
        const client = new ApiClient();
        assert.ok(client);
    });

    test("ApiClient should handle missing configuration gracefully", async () => {
        await vscode.workspace
            .getConfiguration("workShare")
            .update("apiServerUrl", "", vscode.ConfigurationTarget.Global);

        const client = new ApiClient();
        // Should not throw when API URL is not configured
        await assert.doesNotReject(async () => {
            await client.sendActivities([]);
        });
    });

    test("login should store auth state and attach bearer token to later requests", async () => {
        installFetchMock(async (url, init) => {
            if (url.endsWith("/auth/login")) {
                const requestBody = JSON.parse(String(init?.body ?? "{}")) as { username?: string; password?: string };
                assert.strictEqual(requestBody.username, "alice");
                assert.strictEqual(requestBody.password, "password123");

                return jsonResponse(200, {
                    token: "token-123",
                    username: "alice",
                });
            }

            if (url.endsWith("/activities")) {
                const headers = init?.headers as Record<string, string> | undefined;
                assert.strictEqual(headers?.Authorization, "Bearer token-123");
                return jsonResponse(200, { success: true });
            }

            throw new Error(`Unexpected request: ${url}`);
        });

        const client = new ApiClient();

        const result = await client.login("alice", "password123");

        assert.deepStrictEqual(result, {
            token: "token-123",
            username: "alice",
        });
        assert.strictEqual(client.isAuthRequired(), false);
        assert.strictEqual(client.getAuthenticatedUsername(), "alice");

        await client.sendActivities([sampleActivity]);

        assert.strictEqual(fetchCalls.length, 2);
        assert.strictEqual(fetchCalls[0].url, "http://work-share.test/auth/login");
        assert.strictEqual(fetchCalls[1].url, "http://work-share.test/activities");
    });

    test("logout should call auth endpoint and clear stored auth state", async () => {
        installFetchMock(async (url, init) => {
            assert.strictEqual(url, "http://work-share.test/auth/logout");
            const headers = init?.headers as Record<string, string> | undefined;
            assert.strictEqual(headers?.Authorization, "Bearer token-123");
            return jsonResponse(200, { success: true });
        });

        const client = new ApiClient();
        let authStateChangeCount = 0;
        client.onDidChangeAuthState(() => {
            authStateChangeCount += 1;
        });

        client.setAuthToken("token-123", "alice");
        await client.logout();

        assert.strictEqual(client.isAuthRequired(), true);
        assert.strictEqual(client.getAuthenticatedUsername(), undefined);
        assert.strictEqual(authStateChangeCount, 1);
        assert.strictEqual(fetchCalls.length, 1);
    });

    test("401 responses should switch the client into auth-required state", async () => {
        installFetchMock(async (url) => {
            assert.strictEqual(url, "http://work-share.test/activities");
            return jsonResponse(401, { message: "Authentication required." });
        });

        const client = new ApiClient();
        let authStateChangeCount = 0;
        client.onDidChangeAuthState(() => {
            authStateChangeCount += 1;
        });

        client.setAuthToken("stale-token", "alice");
        await client.sendActivities([sampleActivity]);

        assert.strictEqual(client.isAuthRequired(), true);
        assert.strictEqual(client.getAuthenticatedUsername(), undefined);
        assert.strictEqual(client.getConnectionIssue(), undefined);
        assert.strictEqual(authStateChangeCount, 1);
    });

    test("updateConfiguration should preserve the auth header on a rebuilt client", async () => {
        installFetchMock(async (url, init) => {
            assert.strictEqual(url, "http://work-share-two.test/activities");
            const headers = init?.headers as Record<string, string> | undefined;
            assert.strictEqual(headers?.Authorization, "Bearer token-456");
            return jsonResponse(200, { success: true });
        });

        const client = new ApiClient();
        client.setAuthToken("token-456", "alice");

        await vscode.workspace
            .getConfiguration("workShare")
            .update("apiServerUrl", "http://work-share-two.test", vscode.ConfigurationTarget.Global);

        client.updateConfiguration();
        await client.sendActivities([sampleActivity]);

        assert.strictEqual(fetchCalls.length, 1);
    });
});
