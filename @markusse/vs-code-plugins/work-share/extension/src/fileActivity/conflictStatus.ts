import { ConflictSeverity, ConflictStatus } from "./types";

/**
 * Shared throttle interval for conflict-status refresh in tree providers.
 */
export const CONFLICT_STATUS_REFRESH_INTERVAL_MS = 5000;

/**
 * Returns the higher of two conflict severity levels.
 */
export function escalateSeverity(current: ConflictSeverity, next: ConflictSeverity): ConflictSeverity {
    if (current === "definite" || next === "definite") {
        return "definite";
    }
    if (current === "likely" || next === "likely") {
        return "likely";
    }
    return "none";
}

/**
 * Parses hunk line ranges from the new-file side of a unified diff.
 * Returns the `+start,length` range for each @@ header as `{start, end}` pairs.
 */
export function parseHunkRanges(patchText: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const re = /^@@ [^+]*\+(\d+)(?:,(\d+))? @@/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(patchText)) !== null) {
        const start = parseInt(m[1], 10);
        const length = m[2] !== undefined ? parseInt(m[2], 10) : 1;
        ranges.push({ start, end: start + Math.max(length - 1, 0) });
    }
    return ranges;
}

/**
 * Returns true if any hunk range from patchA is within `proximityLines` of any range from patchB.
 * Used as a heuristic to detect "likely" conflicts when a 3-way merge succeeds but edits are near each other.
 * Note: both patches should ideally be relative to the same base commit for accurate comparison.
 */
export function patchHunksNearby(patchA: string, patchB: string, proximityLines = 10): boolean {
    const rangesA = parseHunkRanges(patchA);
    const rangesB = parseHunkRanges(patchB);
    for (const a of rangesA) {
        for (const b of rangesB) {
            if (a.start <= b.end + proximityLines && b.start <= a.end + proximityLines) {
                return true;
            }
        }
    }
    return false;
}

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
