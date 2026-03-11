import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import authRoutes from "./authRoutes";
import db from "../database/db";
import { SESSION_COOKIE_NAME } from "../middleware/auth";

describe("authRoutes cookie session flow", () => {
    let app: express.Application;

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use(cookieParser());
        app.use(authRoutes);

        // Keep tests isolated even when running repeatedly against the same SQLite file.
        db.exec(`
            DELETE FROM sessions;
            DELETE FROM team_sharing;
            DELETE FROM team_members;
            DELETE FROM teams;
            DELETE FROM ssh_keys;
            DELETE FROM users;
        `);
    });

    it("register sets session cookie and /auth/me reads it", async () => {
        const agent = request.agent(app);

        const registerResponse = await agent.post("/auth/register").send({
            username: "alice",
            fullName: "Alice Doe",
            email: "alice@example.com",
            password: "password123",
        });

        expect(registerResponse.status).toBe(201);
        const registerSetCookie = registerResponse.headers["set-cookie"];
        const setCookie = Array.isArray(registerSetCookie) ? registerSetCookie : undefined;
        expect(setCookie?.some((cookie) => cookie.includes(`${SESSION_COOKIE_NAME}=`))).toBe(true);

        const meResponse = await agent.get("/auth/me");
        expect(meResponse.status).toBe(200);
        expect(meResponse.body.username).toBe("alice");
        expect(meResponse.body.fullName).toBe("Alice Doe");
        expect(meResponse.body.email).toBe("alice@example.com");
    });

    it("login sets session cookie and allows profile fetch", async () => {
        await request(app).post("/auth/register").send({
            username: "bob",
            fullName: "Bob Doe",
            email: "bob@example.com",
            password: "password123",
        });

        const agent = request.agent(app);
        const loginResponse = await agent.post("/auth/login").send({
            username: "bob",
            password: "password123",
        });

        expect(loginResponse.status).toBe(200);
        const loginSetCookie = loginResponse.headers["set-cookie"];
        const setCookie = Array.isArray(loginSetCookie) ? loginSetCookie : undefined;
        expect(setCookie?.some((cookie) => cookie.includes(`${SESSION_COOKIE_NAME}=`))).toBe(true);

        const meResponse = await agent.get("/auth/me");
        expect(meResponse.status).toBe(200);
        expect(meResponse.body.username).toBe("bob");
    });

    it("logout clears cookie-backed session and blocks /auth/me", async () => {
        const agent = request.agent(app);

        await agent.post("/auth/register").send({
            username: "charlie",
            fullName: "Charlie Doe",
            email: "charlie@example.com",
            password: "password123",
        });

        const logoutResponse = await agent.post("/auth/logout");
        expect(logoutResponse.status).toBe(200);

        const meResponse = await agent.get("/auth/me");
        expect(meResponse.status).toBe(401);
    });

    it("rejects /auth/me when unauthenticated", async () => {
        const response = await request(app).get("/auth/me");
        expect(response.status).toBe(401);
    });
});
