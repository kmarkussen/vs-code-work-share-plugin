import axios, { AxiosInstance } from "axios";
import * as vscode from "vscode";
import { FileActivity } from "./fileActivityTracker";
import { SharedPatch } from "./sharedPatch";
import { OutputLogger } from "./outputLogger";

/**
 * Response shape returned by the server `GET /activities` endpoint.
 */
interface GetActivitiesResponse {
    count: number;
    activities: Array<{
        filePath: string;
        userName: string;
        timestamp: string;
        action: "open" | "edit" | "close";
        repositoryRemoteUrl: string;
    }>;
}

/**
 * Response shape returned by the server `GET /patches` endpoint.
 */
interface GetPatchesResponse {
    count: number;
    patches: Array<{
        repositoryRemoteUrl: string;
        userName: string;
        repositoryFilePath: string;
        baseCommit: string;
        patch: string;
        timestamp: string;
    }>;
}

type ConnectionIssueLevel = "warning" | "error";

interface ConnectionIssue {
    level: ConnectionIssueLevel;
    message: string;
}

/**
 * Small API abstraction for sending and querying activity data.
 */
export class ApiClient {
    private client: AxiosInstance | undefined;
    private unconfiguredWarnings = new Set<string>();
    private connectionIssue: ConnectionIssue | undefined;

    constructor(private logger?: OutputLogger) {
        this.initializeClient();
    }

    /**
     * Initializes Axios client from extension settings.
     */
    private initializeClient() {
        const config = vscode.workspace.getConfiguration("workShare");
        const apiServerUrl = config.get<string>("apiServerUrl");

        this.client = undefined;
        this.unconfiguredWarnings.clear();
        this.connectionIssue = undefined;

        if (!apiServerUrl?.trim()) {
            this.connectionIssue = {
                level: "warning",
                message: "Work Share API server URL is not configured.",
            };
            this.logger?.warn("API client not configured. Set workShare.apiServerUrl to enable sync.");
            return;
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(apiServerUrl);
        } catch {
            this.connectionIssue = {
                level: "error",
                message: "Work Share API server URL is invalid.",
            };
            this.logger?.error("API client URL is invalid.", { apiServerUrl });
            return;
        }

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            this.connectionIssue = {
                level: "error",
                message: "Work Share API server URL must use http or https.",
            };
            this.logger?.error("API client URL protocol is unsupported.", { apiServerUrl });
            return;
        }

        this.client = axios.create({
            baseURL: apiServerUrl,
            timeout: 5000,
            headers: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                "Content-Type": "application/json",
            },
        });

        this.logger?.info("API client configured.", { apiServerUrl });
    }

    /**
     * Returns current connection issue, if any, for tree-view status rendering.
     */
    public getConnectionIssue(): ConnectionIssue | undefined {
        return this.connectionIssue;
    }

    /**
     * Logs a missing-client warning once per operation key to avoid output spam.
     */
    private warnIfClientMissingOnce(key: string, message: string): void {
        if (this.client || this.unconfiguredWarnings.has(key)) {
            return;
        }

        this.unconfiguredWarnings.add(key);
        this.logger?.warn(message);
    }

    private markConnectionHealthy(): void {
        this.connectionIssue = undefined;
    }

    private markConnectionError(message: string): void {
        this.connectionIssue = {
            level: "error",
            message,
        };
    }

    /**
     * Sends local activity events to the remote API.
     */
    public async sendActivities(activities: FileActivity[]): Promise<void> {
        if (!this.client) {
            console.log("API client not configured. Skipping activity send.");
            this.warnIfClientMissingOnce(
                "sendActivities",
                "Skipping activity POST because API client is not configured.",
            );
            return;
        }

        const payload = activities.map((a) => ({
            filePath: a.filePath,
            userName: a.userName,
            timestamp: a.timestamp.toISOString(),
            action: a.action,
            repositoryRemoteUrl: a.repositoryRemoteUrl,
        }));

        this.logger?.info("POST /activities", {
            count: payload.length,
            activities: payload,
        });

        try {
            await this.client.post("/activities", {
                activities: payload,
            });
            this.markConnectionHealthy();
            this.logger?.info("POST /activities succeeded.", { count: payload.length });
        } catch (error) {
            this.markConnectionError("Unable to send activities to Work Share API.");
            this.logger?.error("POST /activities failed.", {
                message: axios.isAxiosError(error) ? error.message : String(error),
            });
            if (axios.isAxiosError(error)) {
                throw new Error(`API request failed: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Retrieves activity events from the API, optionally filtered by repository or user.
     */
    public async getActivities(filters?: { repositoryRemoteUrl?: string; userName?: string }): Promise<FileActivity[]> {
        if (!this.client) {
            this.warnIfClientMissingOnce(
                "getActivities",
                "Skipping GET /activities because API client is not configured.",
            );
            return [];
        }

        try {
            this.logger?.info("GET /activities", { filters });
            const response = await this.client.get<GetActivitiesResponse>("/activities", {
                params: {
                    repositoryRemoteUrl: filters?.repositoryRemoteUrl,
                    userName: filters?.userName,
                },
            });

            // Convert wire format into plugin domain model.
            const activities = response.data.activities.map((activity) => ({
                filePath: activity.filePath,
                userName: activity.userName,
                timestamp: new Date(activity.timestamp),
                action: activity.action,
                repositoryRemoteUrl: activity.repositoryRemoteUrl,
            }));

            this.logger?.info("GET /activities received.", {
                count: activities.length,
                activities: activities.map((activity) => ({
                    filePath: activity.filePath,
                    userName: activity.userName,
                    timestamp: activity.timestamp.toISOString(),
                    action: activity.action,
                    repositoryRemoteUrl: activity.repositoryRemoteUrl,
                })),
            });

            this.markConnectionHealthy();

            return activities;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.markConnectionError("Unable to fetch activities from Work Share API.");
                console.error(`Failed to fetch activities: ${error.message}`);
                this.logger?.error("GET /activities failed.", { message: error.message, filters });
                return [];
            }
            throw error;
        }
    }

    /**
     * Publishes a generated patch for other users to evaluate locally.
     */
    public async sendPatch(patch: SharedPatch): Promise<void> {
        if (!this.client) {
            this.warnIfClientMissingOnce("sendPatch", "Skipping POST /patches because API client is not configured.");
            return;
        }

        this.logger?.info("POST /patches", {
            repositoryRemoteUrl: patch.repositoryRemoteUrl,
            userName: patch.userName,
            repositoryFilePath: patch.repositoryFilePath,
            baseCommit: patch.baseCommit,
            patch,
        });

        try {
            await this.client.post("/patches", {
                repositoryRemoteUrl: patch.repositoryRemoteUrl,
                userName: patch.userName,
                repositoryFilePath: patch.repositoryFilePath,
                baseCommit: patch.baseCommit,
                patch: patch.patch,
                timestamp: patch.timestamp.toISOString(),
            });
            this.markConnectionHealthy();
            this.logger?.info("POST /patches succeeded.", {
                repositoryFilePath: patch.repositoryFilePath,
                userName: patch.userName,
            });
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.markConnectionError("Unable to send patches to Work Share API.");
                console.error(`Failed to send patch: ${error.message}`);
                this.logger?.error("POST /patches failed.", {
                    message: error.message,
                    repositoryFilePath: patch.repositoryFilePath,
                });
                return;
            }
            throw error;
        }
    }

    /**
     * Retrieves shared patches, optionally scoped by repository, file, or user.
     */
    public async getPatches(filters?: {
        repositoryRemoteUrl?: string;
        repositoryFilePath?: string;
        userName?: string;
    }): Promise<SharedPatch[]> {
        if (!this.client) {
            this.warnIfClientMissingOnce("getPatches", "Skipping GET /patches because API client is not configured.");
            return [];
        }

        try {
            this.logger?.info("GET /patches", { filters });
            const response = await this.client.get<GetPatchesResponse>("/patches", {
                params: {
                    repositoryRemoteUrl: filters?.repositoryRemoteUrl,
                    repositoryFilePath: filters?.repositoryFilePath,
                    userName: filters?.userName,
                },
            });

            const patches = response.data.patches.map((patch) => ({
                repositoryRemoteUrl: patch.repositoryRemoteUrl,
                userName: patch.userName,
                repositoryFilePath: patch.repositoryFilePath,
                baseCommit: patch.baseCommit,
                patch: patch.patch,
                timestamp: new Date(patch.timestamp),
            }));

            this.logger?.info("GET /patches received.", {
                count: patches.length,
                patches,
            });

            this.markConnectionHealthy();

            return patches;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.markConnectionError("Unable to fetch patches from Work Share API.");
                console.error(`Failed to fetch patches: ${error.message}`);
                this.logger?.error("GET /patches failed.", { message: error.message, filters });
                return [];
            }
            throw error;
        }
    }

    /**
     * Rebuilds API client when configuration changes.
     */
    public updateConfiguration() {
        this.initializeClient();
    }
}
