import { JsonController, Post, Body, Get, QueryParam } from "routing-controllers";
import { ActivityBatchDto } from "../dtos/ActivityBatchDto";
import { ActivityDto } from "../dtos/ActivityDto";
import { PatchDto } from "../dtos/PatchDto";

/**
 * Stored activity extends wire payload with server ingestion timestamp.
 */
interface StoredActivity extends ActivityDto {
    receivedAt: string;
}

/**
 * Stored patch extends wire payload with server metadata.
 */
interface StoredPatch extends PatchDto {
    id: string;
    receivedAt: string;
}

/**
 * Handles ingestion and querying of repository-scoped file activity.
 */
@JsonController()
export class ActivityController {
    private activities: Map<string, StoredActivity[]> = new Map();
    private patches: Map<string, StoredPatch[]> = new Map();

    /**
     * Returns shared patches, optionally filtered by repository, file, and user.
     */
    @Get("/patches")
    getPatches(
        @QueryParam("repositoryRemoteUrl") repositoryRemoteUrl?: string,
        @QueryParam("repositoryFilePath") repositoryFilePath?: string,
        @QueryParam("userName") userName?: string,
    ) {
        let patches = Array.from(this.patches.values()).flat();

        if (repositoryRemoteUrl) {
            patches = patches.filter((patch) => patch.repositoryRemoteUrl === repositoryRemoteUrl);
        }

        if (repositoryFilePath) {
            patches = patches.filter((patch) => patch.repositoryFilePath === repositoryFilePath);
        }

        if (userName) {
            patches = patches.filter((patch) => patch.userName === userName);
        }

        patches.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

        return {
            count: patches.length,
            patches,
        };
    }

    /**
     * Receives a generated git patch and stores it in memory.
     */
    @Post("/patches")
    async receivePatch(@Body() patch: PatchDto) {
        const key = `${patch.repositoryRemoteUrl}:${patch.repositoryFilePath}`;
        if (!this.patches.has(key)) {
            this.patches.set(key, []);
        }

        const records = this.patches.get(key)!;
        const existingPatch = records.find(
            (record) =>
                record.userName === patch.userName &&
                record.baseCommit === patch.baseCommit &&
                record.patch === patch.patch,
        );

        if (!existingPatch) {
            records.push({
                ...patch,
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                receivedAt: new Date().toISOString(),
            });
        }

        // Keep most recent records per file key to avoid unbounded memory usage.
        if (records.length > 200) {
            records.splice(0, records.length - 200);
        }

        return {
            success: true,
            message: "Patch stored",
            timestamp: new Date().toISOString(),
        };
    }

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
