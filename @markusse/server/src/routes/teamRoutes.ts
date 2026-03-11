import { Router, Response } from "express";
import db from "../database/db";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = Router();

/** POST /api/teams — create a new team. */
router.post("/api/teams", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { teamName } = req.body ?? {};
    const username = req.authenticatedUsername!;

    if (!teamName || typeof teamName !== "string" || !teamName.trim()) {
        res.status(400).json({ error: "teamName is required." });
        return;
    }

    const normalized = teamName.trim();
    const existing = db.prepare("SELECT team_name FROM teams WHERE team_name = ?").get(normalized);
    if (existing) {
        res.status(409).json({ error: "Team name already in use." });
        return;
    }

    const createTeam = db.transaction(() => {
        db.prepare("INSERT INTO teams (team_name, owner_username) VALUES (?, ?)").run(normalized, username);
        // Owner is automatically an active member.
        db.prepare("INSERT INTO team_members (team_name, username, status, joined_at) VALUES (?, ?, 'active', ?)").run(
            normalized,
            username,
            new Date().toISOString(),
        );
        // Sharing enabled by default.
        db.prepare("INSERT INTO team_sharing (team_name, username, sharing_enabled) VALUES (?, ?, 1)").run(
            normalized,
            username,
        );
    });
    createTeam();

    res.status(201).json({ teamName: normalized, ownerUsername: username });
});

/** GET /api/teams — list all teams the authenticated user is an active member of. */
router.get("/api/teams", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const username = req.authenticatedUsername!;
    const teams = db
        .prepare(
            `
        SELECT t.team_name AS teamName,
               t.owner_username AS ownerUsername,
               t.created_at AS createdAt,
               (SELECT COUNT(*) FROM team_members tm2 WHERE tm2.team_name = t.team_name AND tm2.status = 'active') AS memberCount
        FROM teams t
        JOIN team_members tm ON t.team_name = tm.team_name
        WHERE tm.username = ? AND tm.status = 'active'
        ORDER BY t.team_name
    `,
        )
        .all(username) as Array<{
        teamName: string;
        ownerUsername: string;
        createdAt: string;
        memberCount: number;
    }>;

    res.json(
        teams.map((t) => ({
            teamName: t.teamName,
            ownerUsername: t.ownerUsername,
            createdAt: t.createdAt,
            memberCount: t.memberCount,
            isOwner: t.ownerUsername === username,
        })),
    );
});

/** GET /api/teams/:teamName — get team details including member list with sharing status. */
router.get("/api/teams/:teamName", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { teamName } = req.params;
    const username = req.authenticatedUsername!;

    // Must be an active member to view.
    const membership = db
        .prepare("SELECT status FROM team_members WHERE team_name = ? AND username = ?")
        .get(teamName, username) as { status: string } | undefined;

    if (!membership || membership.status !== "active") {
        res.status(403).json({ error: "You are not a member of this team." });
        return;
    }

    const team = db
        .prepare(
            "SELECT team_name AS teamName, owner_username AS ownerUsername, created_at AS createdAt FROM teams WHERE team_name = ?",
        )
        .get(teamName) as { teamName: string; ownerUsername: string; createdAt: string } | undefined;

    if (!team) {
        res.status(404).json({ error: "Team not found." });
        return;
    }

    const members = db
        .prepare(
            `
        SELECT tm.username,
               u.full_name AS fullName,
               tm.status,
               tm.joined_at AS joinedAt,
               COALESCE(ts.sharing_enabled, 1) AS sharingEnabled,
               ts.disabled_at AS disabledAt
        FROM team_members tm
        JOIN users u ON tm.username = u.username
        LEFT JOIN team_sharing ts ON ts.team_name = tm.team_name AND ts.username = tm.username
        WHERE tm.team_name = ?
        ORDER BY tm.joined_at
    `,
        )
        .all(teamName) as Array<{
        username: string;
        fullName: string;
        status: string;
        joinedAt: string | null;
        sharingEnabled: number;
        disabledAt: string | null;
    }>;

    res.json({
        teamName: team.teamName,
        ownerUsername: team.ownerUsername,
        createdAt: team.createdAt,
        members: members.map((m) => ({
            username: m.username,
            fullName: m.fullName,
            status: m.status,
            joinedAt: m.joinedAt,
            sharingEnabled: m.sharingEnabled === 1,
            disabledAt: m.disabledAt,
        })),
    });
});

/** DELETE /api/teams/:teamName — owner deletes the team. */
router.delete("/api/teams/:teamName", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { teamName } = req.params;
    const username = req.authenticatedUsername!;

    const team = db.prepare("SELECT owner_username AS ownerUsername FROM teams WHERE team_name = ?").get(teamName) as
        | { ownerUsername: string }
        | undefined;

    if (!team) {
        res.status(404).json({ error: "Team not found." });
        return;
    }
    if (team.ownerUsername !== username) {
        res.status(403).json({ error: "Only the team owner can delete the team." });
        return;
    }

    db.prepare("DELETE FROM teams WHERE team_name = ?").run(teamName);
    res.json({ success: true });
});

/** POST /api/teams/:teamName/members — owner adds an existing user by username or email. */
router.post("/api/teams/:teamName/members", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { teamName } = req.params;
    const { usernameOrEmail } = req.body ?? {};
    const username = req.authenticatedUsername!;

    if (!usernameOrEmail) {
        res.status(400).json({ error: "usernameOrEmail is required." });
        return;
    }

    const team = db.prepare("SELECT owner_username AS ownerUsername FROM teams WHERE team_name = ?").get(teamName) as
        | { ownerUsername: string }
        | undefined;

    if (!team) {
        res.status(404).json({ error: "Team not found." });
        return;
    }
    if (team.ownerUsername !== username) {
        res.status(403).json({ error: "Only the team owner can add members." });
        return;
    }

    const target = db
        .prepare("SELECT username FROM users WHERE username = ? OR email = ?")
        .get(usernameOrEmail, usernameOrEmail) as { username: string } | undefined;

    if (!target) {
        res.status(404).json({ error: "No user found with that username or email." });
        return;
    }

    if (target.username === username) {
        res.status(400).json({ error: "You are already a member of your own team." });
        return;
    }

    const existing = db
        .prepare("SELECT status FROM team_members WHERE team_name = ? AND username = ?")
        .get(teamName, target.username) as { status: string } | undefined;

    if (existing) {
        res.status(409).json({ error: `User is already a ${existing.status} member.` });
        return;
    }

    db.prepare("INSERT INTO team_members (team_name, username, status) VALUES (?, ?, 'pending')").run(
        teamName,
        target.username,
    );

    res.status(201).json({ teamName, invitedUsername: target.username, status: "pending" });
});

/** GET /api/invitations — list pending invitations for the authenticated user. */
router.get("/api/invitations", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const username = req.authenticatedUsername!;
    const invitations = db
        .prepare(
            `
        SELECT tm.team_name AS teamName,
               t.owner_username AS ownerUsername,
               tm.invited_at AS invitedAt
        FROM team_members tm
        JOIN teams t ON t.team_name = tm.team_name
        WHERE tm.username = ? AND tm.status = 'pending'
        ORDER BY tm.invited_at DESC
    `,
        )
        .all(username) as Array<{ teamName: string; ownerUsername: string; invitedAt: string }>;

    res.json(
        invitations.map((i) => ({
            teamName: i.teamName,
            ownerUsername: i.ownerUsername,
            invitedAt: i.invitedAt,
        })),
    );
});

/** POST /api/invitations/:teamName/accept — accept a pending invitation. */
router.post("/api/invitations/:teamName/accept", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { teamName } = req.params;
    const username = req.authenticatedUsername!;

    const invitation = db
        .prepare("SELECT status FROM team_members WHERE team_name = ? AND username = ?")
        .get(teamName, username) as { status: string } | undefined;

    if (!invitation || invitation.status !== "pending") {
        res.status(404).json({ error: "No pending invitation found for this team." });
        return;
    }

    const acceptInvitation = db.transaction(() => {
        db.prepare("UPDATE team_members SET status = 'active', joined_at = ? WHERE team_name = ? AND username = ?").run(
            new Date().toISOString(),
            teamName,
            username,
        );
        // Insert default sharing record for the new member.
        db.prepare("INSERT OR IGNORE INTO team_sharing (team_name, username, sharing_enabled) VALUES (?, ?, 1)").run(
            teamName,
            username,
        );
    });
    acceptInvitation();

    res.json({ teamName, status: "active" });
});

/** POST /api/invitations/:teamName/decline — decline or leave a team. */
router.post("/api/invitations/:teamName/decline", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { teamName } = req.params;
    const username = req.authenticatedUsername!;

    const membership = db
        .prepare("SELECT status, team_name FROM team_members WHERE team_name = ? AND username = ?")
        .get(teamName, username) as { status: string } | undefined;

    if (!membership) {
        res.status(404).json({ error: "No membership or invitation found for this team." });
        return;
    }

    // Prevent the owner from leaving their own team; they must delete it instead.
    const team = db.prepare("SELECT owner_username AS ownerUsername FROM teams WHERE team_name = ?").get(teamName) as
        | { ownerUsername: string }
        | undefined;

    if (team?.ownerUsername === username) {
        res.status(400).json({ error: "Team owner cannot leave. Delete the team instead." });
        return;
    }

    db.prepare("DELETE FROM team_members WHERE team_name = ? AND username = ?").run(teamName, username);
    db.prepare("DELETE FROM team_sharing WHERE team_name = ? AND username = ?").run(teamName, username);

    res.json({ success: true });
});

/** PATCH /api/teams/:teamName/sharing — enable or disable sharing for the authenticated user in a team. */
router.patch("/api/teams/:teamName/sharing", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { teamName } = req.params;
    const { enabled } = req.body ?? {};
    const username = req.authenticatedUsername!;

    if (typeof enabled !== "boolean") {
        res.status(400).json({ error: "enabled (boolean) is required." });
        return;
    }

    const membership = db
        .prepare("SELECT status FROM team_members WHERE team_name = ? AND username = ?")
        .get(teamName, username) as { status: string } | undefined;

    if (!membership || membership.status !== "active") {
        res.status(403).json({ error: "You are not an active member of this team." });
        return;
    }

    const disabledAt = enabled ? null : new Date().toISOString();
    db.prepare(
        `
        INSERT INTO team_sharing (team_name, username, sharing_enabled, disabled_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(team_name, username) DO UPDATE SET sharing_enabled = excluded.sharing_enabled, disabled_at = excluded.disabled_at
    `,
    ).run(teamName, username, enabled ? 1 : 0, disabledAt);

    res.json({ teamName, username, sharingEnabled: enabled, disabledAt });
});

export default router;
