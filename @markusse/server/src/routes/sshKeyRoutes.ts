import { Router, Response } from "express";
import db from "../database/db";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = Router();

/** GET /profile/ssh-keys — list the authenticated user's SSH keys. */
router.get("/profile/ssh-keys", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const keys = db
        .prepare("SELECT id, label, public_key, created_at FROM ssh_keys WHERE username = ? ORDER BY created_at")
        .all(req.authenticatedUsername) as Array<{ id: number; label: string; public_key: string; created_at: string }>;

    res.json(
        keys.map((k) => ({
            id: k.id,
            label: k.label,
            publicKey: k.public_key,
            createdAt: k.created_at,
        })),
    );
});

/** POST /profile/ssh-keys — add a new SSH key. */
router.post("/profile/ssh-keys", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { label, publicKey } = req.body ?? {};

    if (!label || !publicKey) {
        res.status(400).json({ error: "label and publicKey are required." });
        return;
    }

    // Basic format check: SSH public keys start with a recognized algorithm identifier.
    if (!publicKey.match(/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|sk-ssh-ed25519)\s+/)) {
        res.status(400).json({ error: "publicKey does not appear to be a valid SSH public key." });
        return;
    }

    const result = db
        .prepare("INSERT INTO ssh_keys (username, label, public_key) VALUES (?, ?, ?)")
        .run(req.authenticatedUsername, label.trim(), publicKey.trim());

    res.status(201).json({ id: result.lastInsertRowid, label: label.trim() });
});

/** DELETE /profile/ssh-keys/:id — remove an SSH key. */
router.delete("/profile/ssh-keys/:id", requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        res.status(400).json({ error: "Invalid SSH key id." });
        return;
    }

    const key = db.prepare("SELECT username FROM ssh_keys WHERE id = ?").get(id) as { username: string } | undefined;

    if (!key) {
        res.status(404).json({ error: "SSH key not found." });
        return;
    }

    if (key.username !== req.authenticatedUsername) {
        res.status(403).json({ error: "You can only delete your own SSH keys." });
        return;
    }

    db.prepare("DELETE FROM ssh_keys WHERE id = ?").run(id);
    res.json({ success: true });
});

export default router;
