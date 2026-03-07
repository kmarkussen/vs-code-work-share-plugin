import axios, { AxiosInstance } from "axios";
import * as vscode from "vscode";
import { FileActivity } from "./fileActivityTracker";

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
 * Small API abstraction for sending and querying activity data.
 */
export class ApiClient {
    private client: AxiosInstance | undefined;

    constructor() {
        this.initializeClient();
    }

    /**
     * Initializes Axios client from extension settings.
     */
    private initializeClient() {
        const config = vscode.workspace.getConfiguration("workShare");
        const apiServerUrl = config.get<string>("apiServerUrl");

        if (apiServerUrl) {
            this.client = axios.create({
                baseURL: apiServerUrl,
                timeout: 5000,
                headers: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    "Content-Type": "application/json",
                },
            });
        }
    }

    /**
     * Sends local activity events to the remote API.
     */
    public async sendActivities(activities: FileActivity[]): Promise<void> {
        if (!this.client) {
            console.log("API client not configured. Skipping activity send.");
            return;
        }

        try {
            await this.client.post("/activities", {
                activities: activities.map((a) => ({
                    filePath: a.filePath,
                    userName: a.userName,
                    timestamp: a.timestamp.toISOString(),
                    action: a.action,
                    repositoryRemoteUrl: a.repositoryRemoteUrl,
                })),
            });
        } catch (error) {
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
            return [];
        }

        try {
            const response = await this.client.get<GetActivitiesResponse>("/activities", {
                params: {
                    repositoryRemoteUrl: filters?.repositoryRemoteUrl,
                    userName: filters?.userName,
                },
            });

            // Convert wire format into plugin domain model.
            return response.data.activities.map((activity) => ({
                filePath: activity.filePath,
                userName: activity.userName,
                timestamp: new Date(activity.timestamp),
                action: activity.action,
                repositoryRemoteUrl: activity.repositoryRemoteUrl,
            }));
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error(`Failed to fetch activities: ${error.message}`);
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
