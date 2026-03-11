import db from "../database/db";

/**
 * Returns the set of usernames that share at least one active team with the given user,
 * where both users have sharing enabled for that team at the relevant timestamp.
 *
 * @param username - The requesting user.
 * @param patchTimestamp - ISO timestamp of the patch being evaluated.
 *   A teammate is included only if their sharing was enabled for their team at this moment.
 */
export function getVisibleTeammates(username: string, patchTimestamp?: string): Set<string> {
    // Find all teams where the requesting user is an active member.
    const userTeams = db
        .prepare(
            `
        SELECT team_name FROM team_members WHERE username = ? AND status = 'active'
    `,
        )
        .all(username) as Array<{ team_name: string }>;

    if (userTeams.length === 0) {
        return new Set();
    }

    const teamNames = userTeams.map((t) => t.team_name);
    const placeholders = teamNames.map(() => "?").join(",");

    // Teammates: active members of any shared team whose sharing was enabled at the patch timestamp.
    const rows = db
        .prepare(
            `
        SELECT DISTINCT tm.username
        FROM team_members tm
        JOIN team_sharing ts ON ts.team_name = tm.team_name AND ts.username = tm.username
        WHERE tm.team_name IN (${placeholders})
          AND tm.status = 'active'
          AND tm.username != ?
          AND (
              ts.sharing_enabled = 1
              OR (
                  -- Sharing was disabled after the patch was uploaded — patch still visible.
                  ts.sharing_enabled = 0
                  AND ts.disabled_at IS NOT NULL
                  AND (? IS NULL OR ts.disabled_at > ?)
              )
          )
    `,
        )
        .all(...teamNames, username, patchTimestamp ?? null, patchTimestamp ?? null) as Array<{ username: string }>;

    return new Set(rows.map((r) => r.username));
}

/**
 * Returns true if the given user currently has sharing enabled for at least one team
 * that includes the viewer as an active member.
 */
export function isSharingEnabledFor(sharerUsername: string, viewerUsername: string): boolean {
    const row = db
        .prepare(
            `
        SELECT 1 FROM team_members sharer
        JOIN team_members viewer ON sharer.team_name = viewer.team_name
        JOIN team_sharing ts ON ts.team_name = sharer.team_name AND ts.username = sharer.username
        WHERE sharer.username = ? AND sharer.status = 'active'
          AND viewer.username = ? AND viewer.status = 'active'
          AND ts.sharing_enabled = 1
        LIMIT 1
    `,
        )
        .get(sharerUsername, viewerUsername);

    return !!row;
}
