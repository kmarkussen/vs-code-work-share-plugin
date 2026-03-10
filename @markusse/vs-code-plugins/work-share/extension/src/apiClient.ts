import axios, { AxiosInstance } from "./axiosCompat";
import * as vscode from "vscode";
import { FileActivity } from "./fileActivityTracker";
import { SharedPatch } from "./sharedPatch";
import { OutputLogger } from "./outputLogger";
import { GetActivitiesResponse, GetPatchesResponse, GetFilesResponse, RepositoryFilesInfo } from "@work-share/types";

type ConnectionIssueLevel = "warning" | "error";

interface ConnectionIssue {
    level: ConnectionIssueLevel;
    message: string;
}

interface PatchSyncPayload {
    repositoryRemoteUrl: string;
    userName: string;
    patches: SharedPatch[];
}

/**
 * Small API abstraction for sending and querying activity data.
 */
export class ApiClient {
    private client: AxiosInstance | undefined;
    private unconfiguredWarnings = new Set<string>();
    private connectionIssue: ConnectionIssue | undefined;

    private _onDidChangeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeData: vscode.Event<void> = this._onDidChangeData.event;

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
        const hadIssue = this.connectionIssue !== undefined;
        this.connectionIssue = undefined;
        if (hadIssue) {
            this._onDidChangeData.fire();
        }
    }

    private markConnectionError(message: string): void {
        const changed = this.connectionIssue?.message !== message;
        this.connectionIssue = {
            level: "error",
            message,
        };
        if (changed) {
            this._onDidChangeData.fire();
        }
    }

    private isIdentityRejected(error: unknown): boolean {
        if (!axios.isAxiosError(error)) {
            return false;
        }

        const responseMessage =
            typeof error.response?.data === "object" && error.response?.data && "message" in error.response.data ?
                String((error.response.data as { message?: unknown }).message ?? "")
            :   "";

        return error.response?.status === 400 && /identity is required/i.test(responseMessage);
    }

    private getIdentityRequiredMessage(): string {
        return "Client identity missing. Set workShare.userName or git user.name.";
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
            if (this.isIdentityRejected(error)) {
                this.markConnectionError(this.getIdentityRequiredMessage());
                this.logger?.error("POST /activities rejected: missing client identity.");
                throw new Error(this.getIdentityRequiredMessage());
            }

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
                changeType: patch.changeType,
                workingState: patch.workingState,
                commitSha: patch.commitSha,
                commitShortSha: patch.commitShortSha,
                commitMessage: patch.commitMessage,
                contentHash: patch.contentHash,
            });
            this.markConnectionHealthy();
            this.logger?.info("POST /patches succeeded.", {
                repositoryFilePath: patch.repositoryFilePath,
                userName: patch.userName,
            });
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (this.isIdentityRejected(error)) {
                    this.markConnectionError(this.getIdentityRequiredMessage());
                    this.logger?.error("POST /patches rejected: missing client identity.");
                    return;
                }

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
     * Synchronizes a user's active patch set for a repository, replacing stale server-side records.
     */
    public async syncRepositoryUserPatches(payload: PatchSyncPayload): Promise<void> {
        if (!this.client) {
            this.warnIfClientMissingOnce(
                "syncRepositoryUserPatches",
                "Skipping POST /patches/sync because API client is not configured.",
            );
            return;
        }

        this.logger?.info("POST /patches/sync", {
            repositoryRemoteUrl: payload.repositoryRemoteUrl,
            userName: payload.userName,
            patchCount: payload.patches.length,
        });

        try {
            await this.client.post("/patches/sync", {
                repositoryRemoteUrl: payload.repositoryRemoteUrl,
                userName: payload.userName,
                patches: payload.patches.map((patch) => ({
                    repositoryRemoteUrl: patch.repositoryRemoteUrl,
                    userName: patch.userName,
                    repositoryFilePath: patch.repositoryFilePath,
                    baseCommit: patch.baseCommit,
                    patch: patch.patch,
                    timestamp: patch.timestamp.toISOString(),
                    committed: patch.committed,
                    changeType: patch.changeType,
                    workingState: patch.workingState,
                    commitSha: patch.commitSha,
                    commitShortSha: patch.commitShortSha,
                    commitMessage: patch.commitMessage,
                    contentHash: patch.contentHash,
                })),
            });

            this.markConnectionHealthy();
            this.logger?.info("POST /patches/sync succeeded.", {
                repositoryRemoteUrl: payload.repositoryRemoteUrl,
                userName: payload.userName,
                patchCount: payload.patches.length,
            });
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (this.isIdentityRejected(error)) {
                    this.markConnectionError(this.getIdentityRequiredMessage());
                    this.logger?.error("POST /patches/sync rejected: missing client identity.");
                    return;
                }

                this.markConnectionError("Unable to synchronize patches with Work Share API.");
                this.logger?.error("POST /patches/sync failed.", {
                    message: error.message,
                    repositoryRemoteUrl: payload.repositoryRemoteUrl,
                    userName: payload.userName,
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
        this._onDidChangeData.fire();
    }

    /**
     * Retrieves files organized by repository with active users and patches.
     */
    public async getFiles(filters?: { repositoryRemoteUrl?: string }): Promise<RepositoryFilesInfo[]> {
        if (!this.client) {
            this.warnIfClientMissingOnce("getFiles", "Skipping GET /files because API client is not configured.");
            return [];
        }

        try {
            this.logger?.info("GET /files", { filters });
            const response = await this.client.get<unknown>("/files", {
                params: {
                    repositoryRemoteUrl: filters?.repositoryRemoteUrl,
                },
            });

            const payload = response.data;
            const rawRepositories =
                Array.isArray(payload) ? payload
                : (
                    payload &&
                    typeof payload === "object" &&
                    Array.isArray((payload as { repositories?: unknown }).repositories)
                ) ?
                    (payload as { repositories: unknown[] }).repositories
                :   undefined;

            if (!rawRepositories) {
                this.markConnectionError("Invalid response from Work Share API /files endpoint.");
                this.logger?.error("GET /files returned unexpected payload shape.", {
                    payloadType: Array.isArray(payload) ? "array" : typeof payload,
                    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
                });
                return [];
            }

            const repositories = rawRepositories.map((repo) => {
                const typedRepo = repo as Partial<RepositoryFilesInfo>;
                const files = (typedRepo.files ?? []).map((file) => ({
                    repositoryRemoteUrl: file.repositoryRemoteUrl,
                    repositoryFilePath: file.repositoryFilePath,
                    repositoryFileName: file.repositoryFileName,
                    activeUsers: file.activeUsers ?? [],
                    patchCount: typeof file.patchCount === "number" ? file.patchCount : (file.patches?.length ?? 0),
                    patches: file.patches ?? [],
                    lastActivity: file.lastActivity,
                }));

                return {
                    repositoryRemoteUrl: typedRepo.repositoryRemoteUrl ?? "",
                    repositoryName: typedRepo.repositoryName ?? "Unknown repository",
                    fileCount: typeof typedRepo.fileCount === "number" ? typedRepo.fileCount : files.length,
                    files,
                } as RepositoryFilesInfo;
            });

            const normalizedResponse: GetFilesResponse = {
                count:
                    payload && typeof payload === "object" && "count" in payload ?
                        Number((payload as { count?: unknown }).count ?? repositories.length)
                    :   repositories.length,
                repositories,
            };

            this.markConnectionHealthy();
            this.logger?.info("GET /files received.", {
                count: normalizedResponse.count,
            });

            return normalizedResponse.repositories;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                this.markConnectionError("Unable to fetch files from Work Share API.");
                console.error(`Failed to fetch files: ${error.message}`);
                this.logger?.error("GET /files failed.", { message: error.message, filters });
                return [];
            }
            throw error;
        }
    }
}
