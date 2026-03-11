import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt, { JwtPayload } from "jsonwebtoken";
import db from "../database/db";
import { issueToken, requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = Router();
const BCRYPT_ROUNDS = 12;

/** POST /auth/register — create a new user account. */
router.post("/auth/register", (req: Request, res: Response) => {
    const { username, fullName, email, password } = req.body ?? {};

    if (!username || !fullName || !email || !password) {
        res.status(400).json({ error: "username, fullName, email, and password are required." });
        return;
    }

    // Validate username: alphanumeric + hyphens/underscores, 3–32 chars.
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
        res.status(400).json({ error: "Username must be 3–32 characters (letters, digits, _ or -)." });
        return;
    }

    if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters." });
        return;
    }

    const existing = db
        .prepare("SELECT username FROM users WHERE username = ? OR email = ?")
        .get(username, email);
    if (existing) {
        res.status(409).json({ error: "Username or email already in use." });
        return;
    }

    const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    db.prepare(
        "INSERT INTO users (username, full_name, email, password_hash) VALUES (?, ?, ?, ?)"
    ).run(username, fullName, email, passwordHash);

    const token = issueToken(username);
    res.status(201).json({ token, username });
});

/** POST /auth/login — authenticate and receive a session token. */
router.post("/auth/login", (req: Request, res: Response) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
        res.status(400).json({ error: "username and password are required." });
        return;
    }

    const user = db
        .prepare("SELECT username, password_hash FROM users WHERE username = ?")
        .get(username) as { username: string; password_hash: string } | undefined;

    // Use constant-time comparison even when user not found to avoid timing attacks.
    const hashToCheck = user?.password_hash ?? "$2b$12$invalidhashfortimingprotection000000000000000000";
    const valid = bcrypt.compareSync(password, hashToCheck);

    if (!user || !valid) {
        res.status(401).json({ error: "Invalid username or password." });
        return;
    }

    const token = issueToken(username);
    res.json({ token, username });
});

/** POST /auth/logout — revoke the current session token. */
router.post("/auth/logout", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const authHeader = req.headers.authorization!;
    const token = authHeader.slice(7);
    try {
        const payload = jwt.verify(
            token,
            process.env.JWT_SECRET || "dev-secret-change-in-production",
        ) as JwtPayload;
        db.prepare("DELETE FROM sessions WHERE token_id = ?").run(payload.jti as string);
    } catch {
        // Token already invalid — session was either expired or already deleted.
    }
    res.json({ success: true });
});

/** GET /auth/me — return the authenticated user's profile. */
router.get("/auth/me", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = db
        .prepare("SELECT username, full_name, email, created_at FROM users WHERE username = ?")
        .get(req.authenticatedUsername) as { username: string; full_name: string; email: string; created_at: string } | undefined;

    if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
    }

    res.json({
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        createdAt: user.created_at,
    });
});

/** PATCH /auth/me — update mutable profile fields (fullName, email, password). */
router.patch("/auth/me", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { fullName, email, currentPassword, newPassword } = req.body ?? {};
    const username = req.authenticatedUsername!;

    if (newPassword !== undefined) {
        if (!currentPassword) {
            res.status(400).json({ error: "currentPassword is required to change password." });
            return;
        }
        const user = db
            .prepare("SELECT password_hash FROM users WHERE username = ?")
            .get(username) as { password_hash: string } | undefined;

        if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
            res.status(401).json({ error: "Current password is incorrect." });
            return;
        }
        if (newPassword.length < 8) {
            res.status(400).json({ error: "New password must be at least 8 characters." });
            return;
        }
        const newHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
        db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(newHash, username);
    }

    if (fullName !== undefined) {
        db.prepare("UPDATE users SET full_name = ? WHERE username = ?").run(fullName, username);
    }

    if (email !== undefined) {
        const conflict = db
            .prepare("SELECT username FROM users WHERE email = ? AND username != ?")
            .get(email, username);
        if (conflict) {
            res.status(409).json({ error: "Email already in use by another account." });
            return;
        }
        db.prepare("UPDATE users SET email = ? WHERE username = ?").run(email, username);
    }

    res.json({ success: true });
});

export default router;
