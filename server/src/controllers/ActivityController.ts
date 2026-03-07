import { JsonController, Post, Body, Get, QueryParam, BadRequestError } from "routing-controllers";
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

// Keep in-memory state at module scope so it persists even if controller instances are recreated per request.
const activityStore: Map<string, StoredActivity[]> = new Map();
const patchStore: Map<string, StoredPatch[]> = new Map();

/**
 * Validates caller identity and rejects ambiguous placeholders.
 */
function normalizeAndValidateIdentity(userName: string): string {
    const normalizedUserName = userName.trim();
    const normalizedLower = normalizedUserName.toLowerCase();
    if (!normalizedUserName || normalizedLower === "unknown user" || normalizedLower === "unknown") {
        throw new BadRequestError("Client identity is required. Configure workShare.userName or git user.name.");
    }

    return normalizedUserName;
}

/**
 * Handles ingestion and querying of repository-scoped file activity.
 */
@JsonController()
export class ActivityController {
    /**
     * Returns shared patches, optionally filtered by repository, file, and user.
     */
    @Get("/patches")
    getPatches(
        @QueryParam("repositoryRemoteUrl") repositoryRemoteUrl?: string,
        @QueryParam("repositoryFilePath") repositoryFilePath?: string,
        @QueryParam("userName") userName?: string,
    ) {
        let patches = Array.from(patchStore.values()).flat();

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
        const normalizedUserName = normalizeAndValidateIdentity(patch.userName);
        const key = `${patch.repositoryRemoteUrl}:${patch.repositoryFilePath}`;
        if (!patchStore.has(key)) {
            patchStore.set(key, []);
        }

        const records = patchStore.get(key)!;
        const existingPatch = records.find(
            (record) =>
                record.userName === patch.userName &&
                record.baseCommit === patch.baseCommit &&
                record.patch === patch.patch,
        );

        if (!existingPatch) {
            records.push({
                ...patch,
                userName: normalizedUserName,
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
        let activities = Array.from(activityStore.values()).flat();

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
            const normalizedUserName = normalizeAndValidateIdentity(activity.userName);

            // Partition by repository + user + file so each stream is independently append-only.
            const key = `${activity.repositoryRemoteUrl}:${normalizedUserName}:${activity.filePath}`;

            if (!activityStore.has(key)) {
                activityStore.set(key, []);
            }

            activityStore.get(key)!.push({
                ...activity,
                userName: normalizedUserName,
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
