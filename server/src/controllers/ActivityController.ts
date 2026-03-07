import { JsonController, Post, Body, Get, QueryParam } from "routing-controllers";
import { ActivityBatchDto } from "../dtos/ActivityBatchDto";
import { ActivityDto } from "../dtos/ActivityDto";

/**
 * Stored activity extends wire payload with server ingestion timestamp.
 */
interface StoredActivity extends ActivityDto {
    receivedAt: string;
}

/**
 * Handles ingestion and querying of repository-scoped file activity.
 */
@JsonController()
export class ActivityController {
    private activities: Map<string, StoredActivity[]> = new Map();

    /**
     * Returns stored activities, optionally filtered by repository and user.
     */
    @Get("/activities")
    getActivities(
        @QueryParam("repositoryRemoteUrl") repositoryRemoteUrl?: string,
        @QueryParam("userName") userName?: string,
    ) {
        let activities = Array.from(this.activities.values()).flat();

        if (repositoryRemoteUrl) {
            activities = activities.filter((activity) => activity.repositoryRemoteUrl === repositoryRemoteUrl);
        }

        if (userName) {
            activities = activities.filter((activity) => activity.userName === userName);
        }

        return {
            count: activities.length,
            activities,
        };
    }

    /**
     * Ingests activity events from plugin clients and stores them in memory.
     */
    @Post("/activities")
    async receiveActivities(@Body() body: ActivityBatchDto) {
        console.log(`Received ${body.activities.length} activities`);

        // Process each activity
        body.activities.forEach((activity) => {
            // Partition by repository + user + file so each stream is independently append-only.
            const key = `${activity.repositoryRemoteUrl}:${activity.userName}:${activity.filePath}`;

            if (!this.activities.has(key)) {
                this.activities.set(key, []);
            }

            this.activities.get(key)!.push({
                ...activity,
                receivedAt: new Date().toISOString(),
            });

            console.log(
                `[${activity.timestamp}] ${activity.userName} ${activity.action} ${activity.filePath} (${activity.repositoryRemoteUrl})`,
            );
        });

        return {
            success: true,
            message: `Processed ${body.activities.length} activities`,
            timestamp: new Date().toISOString(),
        };
    }
}
