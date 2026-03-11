import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import db from "../database/db";

export const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
/** Token lifetime: 1 hour in seconds. */
export const TOKEN_TTL_SECONDS = 3600;

export interface AuthenticatedRequest extends Request {
    authenticatedUsername?: string;
}

/**
 * Session cookie name for website authentication.
 */
export const SESSION_COOKIE_NAME = "workShareSession";

/**
 * Extracts a JWT from either Authorization header or HttpOnly session cookie.
 */
export function getAuthTokenFromRequest(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
        return authHeader.slice(7);
    }

    const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE_NAME];
    return typeof cookieToken === "string" && cookieToken.length > 0 ? cookieToken : undefined;
}

/**
 * Signs a new JWT session token for the given username.
 * The token ID is stored in the sessions table so it can be revoked.
 */
export function issueToken(username: string): string {
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

    db.prepare("INSERT INTO sessions (token_id, username, expires_at) VALUES (?, ?, ?)").run(
        tokenId,
        username,
        expiresAt,
    );

    return jwt.sign({ sub: username, jti: tokenId }, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

/**
 * Verifies a bearer token and attaches the username to the request.
 * Rejects with 401 if the token is missing, invalid, expired, or revoked.
 */
export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    const authenticatedRequest = req as AuthenticatedRequest;
    const token = getAuthTokenFromRequest(req);
    if (!token) {
        res.status(401).json({ error: "Authentication required." });
        return;
    }

    let payload: JwtPayload;
    try {
        payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
        res.status(401).json({ error: "Invalid or expired token." });
        return;
    }

    // Check the token is still in the sessions table (not yet revoked / expired server-side).
    const row = db
        .prepare("SELECT username FROM sessions WHERE token_id = ? AND expires_at > ?")
        .get(payload.jti as string, new Date().toISOString()) as { username: string } | undefined;

    if (!row) {
        res.status(401).json({ error: "Session expired or revoked." });
        return;
    }

    authenticatedRequest.authenticatedUsername = row.username;
    next();
};

/**
 * Silently refreshes a valid token: extends the session in the DB and
 * returns a new JWT in the `X-Refresh-Token` response header so clients
 * can swap it out without prompting the user.
 */
export const silentRefresh: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    const token = getAuthTokenFromRequest(req);
    if (!token) {
        return next();
    }

    let payload: JwtPayload;
    try {
        payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
        return next();
    }

    const row = db
        .prepare("SELECT username, expires_at FROM sessions WHERE token_id = ?")
        .get(payload.jti as string) as { username: string; expires_at: string } | undefined;

    if (!row) {
        return next();
    }

    // Only refresh if the token is within the last 15 minutes of its lifetime.
    const expiresMs = new Date(row.expires_at).getTime();
    const refreshWindowMs = 15 * 60 * 1000;
    if (expiresMs - Date.now() < refreshWindowMs) {
        const newToken = issueToken(row.username);
        // Delete the old session after issuing a new one.
        db.prepare("DELETE FROM sessions WHERE token_id = ?").run(payload.jti as string);
        res.setHeader("X-Refresh-Token", newToken);
        res.cookie(SESSION_COOKIE_NAME, newToken, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: TOKEN_TTL_SECONDS * 1000,
            path: "/",
        });
    }

    next();
};
