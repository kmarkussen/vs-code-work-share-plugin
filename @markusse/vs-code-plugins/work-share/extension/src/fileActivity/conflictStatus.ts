import { ConflictStatus } from "./types";

/**
 * Shared throttle interval for conflict-status refresh in tree providers.
 */
export const CONFLICT_STATUS_REFRESH_INTERVAL_MS = 5000;

/**
 * Combines patch and remote conflict signals into a single status.
 */
export function combinePatchAndRemoteConflictStatus(
    patchStatus: ConflictStatus | undefined,
    remoteStatus: ConflictStatus | undefined,
): ConflictStatus {
    if (patchStatus === "conflict" || remoteStatus === "conflict") {
        return "conflict";
    }

    if (patchStatus === "clean" && (remoteStatus === "clean" || remoteStatus === undefined)) {
        return "clean";
    }

    return "unknown";
}
