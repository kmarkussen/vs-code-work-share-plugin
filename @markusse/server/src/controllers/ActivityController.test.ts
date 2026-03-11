import "reflect-metadata";
import request from "supertest";
import express from "express";
import { useExpressServer } from "routing-controllers";
import { ActivityController } from "../controllers/ActivityController";
import {
    ActivityDto,
    ActivityBatchDto,
    PatchDto,
    StoredPatch,
    GetFilesResponse,
    GetActivitiesResponse,
    GetPatchesResponse,
    PostActivitiesResponse,
    PostPatchesResponse,
    HealthCheckResponse,
} from "@work-share/types";
import { validate } from "class-validator";
import { plainToClass } from "class-transformer";
import { NextFunction, Request, Response } from "express";

// Bypass JWT auth in unit tests; the x-test-username header drives the identity.
jest.mock("../middleware/auth", () => ({
    requireAuth: (req: Request & { authenticatedUsername?: string }, _res: Response, next: NextFunction) => {
        req.authenticatedUsername = (req.headers["x-test-username"] as string | undefined) ?? "Alice";
        next();
    },
    silentRefresh: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Return all test usernames as visible teammates so visibility filtering is a no-op.
jest.mock("../database/teamQueries", () => ({
    getVisibleTeammates: () => new Set(["Alice", "Bob", "Charlie", "Dana"]),
    isSharingEnabledFor: () => true,
}));

describe("ActivityController", () => {
    let app: express.Application;

    beforeEach(() => {
        // Clear stores to ensure test isolation
        ActivityController.clearStores();

        // Create fresh Express app for each test
        app = express();
        useExpressServer(app, {
            controllers: [ActivityController],
            defaultErrorHandler: true,
        });

        // Add health endpoint
        app.get("/health", (req, res) => {
            const response: HealthCheckResponse = {
                status: "ok",
                timestamp: new Date().toISOString(),
            };
            res.json(response);
        });
    });

    describe("GET /health", () => {
        it("should return health status with correct type", async () => {
            const response = await request(app).get("/health").expect(200);

            // Validate response structure
            expect(response.body).toHaveProperty("status");
            expect(response.body).toHaveProperty("timestamp");
            expect(response.body.status).toBe("ok");

            // Validate response conforms to HealthCheckResponse type
            const healthResponse = plainToClass(HealthCheckResponse, response.body);
            const errors = await validate(healthResponse);
            expect(errors).toHaveLength(0);
        });
    });

    describe("POST /activities", () => {
        it("should accept valid activity batch and return correct response type", async () => {
            const activityBatch: ActivityBatchDto = {
                activities: [
                    {
                        filePath: "/src/index.ts",
                        userName: "Alice",
                        timestamp: new Date().toISOString(),
                        action: "open",
                        repositoryRemoteUrl: "https://github.com/org/repo.git",
                        upstreamBranch: "origin/main",
                    },
                ],
            };

            const response = await request(app)
                .post("/activities")
                .set("x-test-username", "Alice")
                .send(activityBatch)
                .expect(200);

            // Validate response structure
            expect(response.body).toHaveProperty("success");
            expect(response.body).toHaveProperty("message");
            expect(response.body).toHaveProperty("timestamp");
            expect(response.body.success).toBe(true);

            // Validate response conforms to PostActivitiesResponse type
            const postResponse = plainToClass(PostActivitiesResponse, response.body);
            const errors = await validate(postResponse);
            expect(errors).toHaveLength(0);
        });

        it("should reject activity with missing userName", async () => {
            const invalidBatch = {
                activities: [
                    {
                        filePath: "/src/index.ts",
                        // userName missing
                        timestamp: new Date().toISOString(),
                        action: "open",
                        repositoryRemoteUrl: "https://github.com/org/repo.git",
                    },
                ],
            };

            await request(app).post("/activities").set("x-test-username", "Alice").send(invalidBatch).expect(400);
        });

        it("should reject activity with invalid action", async () => {
            const invalidBatch = {
                activities: [
                    {
                        filePath: "/src/index.ts",
                        userName: "Alice",
                        timestamp: new Date().toISOString(),
                        action: "invalid-action", // Should be "open", "edit", or "close"
                        repositoryRemoteUrl: "https://github.com/org/repo.git",
                    },
                ],
            };

            await request(app).post("/activities").set("x-test-username", "Alice").send(invalidBatch).expect(400);
        });

        it("should store activities using the authenticated username, not the body userName", async () => {
            const activityBatch: ActivityBatchDto = {
                activities: [
                    {
                        filePath: "/src/index.ts",
                        userName: "ignored-body-name",
                        timestamp: new Date().toISOString(),
                        action: "open",
                        repositoryRemoteUrl: "https://github.com/org/repo.git",
                    },
                ],
            };

            await request(app).post("/activities").set("x-test-username", "Alice").send(activityBatch).expect(200);

            const response = await request(app)
                .get("/activities")
                .set("x-test-username", "Alice")
                .query({ userName: "Alice" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.activities[0].userName).toBe("Alice");
        });

        it("should handle multiple activities in batch", async () => {
            const activityBatch: ActivityBatchDto = {
                activities: [
                    {
                        filePath: "/src/index.ts",
                        userName: "Alice",
                        timestamp: new Date().toISOString(),
                        action: "open",
                        repositoryRemoteUrl: "https://github.com/org/repo.git",
                        upstreamBranch: "origin/main",
                    },
                    {
                        filePath: "/src/app.ts",
                        userName: "Alice",
                        timestamp: new Date().toISOString(),
                        action: "edit",
                        repositoryRemoteUrl: "https://github.com/org/repo.git",
                    },
                ],
            };

            const response = await request(app)
                .post("/activities")
                .set("x-test-username", "Alice")
                .send(activityBatch)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.message).toContain("2 activities");
        });
    });

    describe("GET /activities", () => {
        beforeEach(async () => {
            // Seed activities for Alice and Bob using per-user request headers.
            await request(app)
                .post("/activities")
                .set("x-test-username", "Alice")
                .send({
                    activities: [
                        {
                            filePath: "/src/index.ts",
                            userName: "Alice",
                            timestamp: new Date().toISOString(),
                            action: "open",
                            repositoryRemoteUrl: "https://github.com/org/repo.git",
                            upstreamBranch: "origin/main",
                        },
                    ],
                });
            await request(app)
                .post("/activities")
                .set("x-test-username", "Bob")
                .send({
                    activities: [
                        {
                            filePath: "/src/app.ts",
                            userName: "Bob",
                            timestamp: new Date().toISOString(),
                            action: "edit",
                            repositoryRemoteUrl: "https://github.com/org/other.git",
                            upstreamBranch: "origin/feature",
                        },
                    ],
                });
        });

        it("should return all activities with correct response type", async () => {
            const response = await request(app).get("/activities").set("x-test-username", "Alice").expect(200);

            // Validate response structure
            expect(response.body).toHaveProperty("count");
            expect(response.body).toHaveProperty("activities");
            expect(Array.isArray(response.body.activities)).toBe(true);
            expect(response.body.count).toBe(2);

            // Validate response conforms to GetActivitiesResponse type
            const getResponse = plainToClass(GetActivitiesResponse, response.body);
            const errors = await validate(getResponse);
            expect(errors).toHaveLength(0);
        });

        it("should filter activities by repositoryRemoteUrl", async () => {
            const response = await request(app)
                .get("/activities")
                .set("x-test-username", "Alice")
                .query({ repositoryRemoteUrl: "https://github.com/org/repo.git" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.activities[0].repositoryRemoteUrl).toBe("https://github.com/org/repo.git");
        });

        it("should filter activities by userName", async () => {
            const response = await request(app)
                .get("/activities")
                .set("x-test-username", "Alice")
                .query({ userName: "Alice" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.activities[0].userName).toBe("Alice");
        });

        it("should filter activities by upstreamBranch", async () => {
            const response = await request(app)
                .get("/activities")
                .set("x-test-username", "Alice")
                .query({ upstreamBranch: "origin/main" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.activities[0].upstreamBranch).toBe("origin/main");
        });
    });

    describe("POST /patches", () => {
        it("should accept valid patch and return correct response type", async () => {
            const patch: PatchDto = {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Alice",
                upstreamBranch: "origin/main",
                repositoryFilePath: "src/index.ts",
                baseCommit: "abc123",
                patch: "diff --git a/src/index.ts b/src/index.ts\\n...",
                timestamp: new Date().toISOString(),
            };

            const response = await request(app)
                .post("/patches")
                .set("x-test-username", "Alice")
                .send(patch)
                .expect(200);

            // Validate response structure
            expect(response.body).toHaveProperty("success");
            expect(response.body).toHaveProperty("message");
            expect(response.body).toHaveProperty("timestamp");
            expect(response.body.success).toBe(true);

            // Validate response conforms to PostPatchesResponse type
            const postResponse = plainToClass(PostPatchesResponse, response.body);
            const errors = await validate(postResponse);
            expect(errors).toHaveLength(0);
        });

        it("should reject patch with missing required fields", async () => {
            const invalidPatch = {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Alice",
                // Missing repositoryFilePath, baseCommit, patch, timestamp
            };

            await request(app).post("/patches").set("x-test-username", "Alice").send(invalidPatch).expect(400);
        });

        it("should not store duplicate patches", async () => {
            const patch: PatchDto = {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Alice",
                upstreamBranch: "origin/main",
                repositoryFilePath: "src/index.ts",
                baseCommit: "abc123",
                patch: "diff --git a/src/index.ts b/src/index.ts\\n...",
                timestamp: new Date().toISOString(),
            };

            // Submit same patch twice
            await request(app).post("/patches").set("x-test-username", "Alice").send(patch).expect(200);
            await request(app).post("/patches").set("x-test-username", "Alice").send(patch).expect(200);

            // Verify only one patch is stored
            const response = await request(app).get("/patches").set("x-test-username", "Alice").expect(200);
            const matchingPatches = response.body.patches.filter(
                (p: StoredPatch) =>
                    p.userName === "Alice" && p.repositoryFilePath === "src/index.ts" && p.baseCommit === "abc123",
            );
            expect(matchingPatches).toHaveLength(1);
        });
    });

    describe("GET /patches", () => {
        beforeEach(async () => {
            // Seed patches using per-user headers so stored usernames are correct.
            const patch1: PatchDto = {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Alice",
                upstreamBranch: "origin/main",
                repositoryFilePath: "src/index.ts",
                baseCommit: "abc123",
                patch: "diff --git a/src/index.ts b/src/index.ts\\n...",
                timestamp: new Date().toISOString(),
                changeType: "pending",
                commitSha: "abc123def",
                commitShortSha: "abc123d",
                commitMessage: "feat: update index",
            };
            const patch2: PatchDto = {
                repositoryRemoteUrl: "https://github.com/org/other.git",
                userName: "Bob",
                upstreamBranch: "origin/feature",
                repositoryFilePath: "src/app.ts",
                baseCommit: "def456",
                patch: "diff --git a/src/app.ts b/src/app.ts\\n...",
                timestamp: new Date().toISOString(),
                changeType: "working",
                workingState: "unstaged",
            };
            await request(app).post("/patches").set("x-test-username", "Alice").send(patch1);
            await request(app).post("/patches").set("x-test-username", "Bob").send(patch2);
        });

        it("should return all patches with correct response type", async () => {
            const response = await request(app).get("/patches").set("x-test-username", "Alice").expect(200);

            // Validate response structure
            expect(response.body).toHaveProperty("count");
            expect(response.body).toHaveProperty("patches");
            expect(Array.isArray(response.body.patches)).toBe(true);
            expect(response.body.count).toBe(2);

            // Validate response conforms to GetPatchesResponse type
            const getResponse = plainToClass(GetPatchesResponse, response.body);
            const errors = await validate(getResponse);
            expect(errors).toHaveLength(0);

            // Validate each patch has required fields
            response.body.patches.forEach((patch: StoredPatch) => {
                expect(patch).toHaveProperty("id");
                expect(patch).toHaveProperty("receivedAt");
                expect(patch).toHaveProperty("repositoryRemoteUrl");
                expect(patch).toHaveProperty("userName");
                expect(patch).toHaveProperty("repositoryFilePath");
                expect(patch).toHaveProperty("baseCommit");
                expect(patch).toHaveProperty("patch");
                expect(patch).toHaveProperty("timestamp");
            });
        });

        it("should filter patches by repositoryRemoteUrl", async () => {
            const response = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ repositoryRemoteUrl: "https://github.com/org/repo.git" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.patches[0].repositoryRemoteUrl).toBe("https://github.com/org/repo.git");
        });

        it("should filter patches by repositoryFilePath", async () => {
            const response = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ repositoryFilePath: "src/index.ts" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.patches[0].repositoryFilePath).toBe("src/index.ts");
        });

        it("should filter patches by userName", async () => {
            const response = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ userName: "Alice" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.patches[0].userName).toBe("Alice");
        });

        it("should filter patches by upstreamBranch", async () => {
            const response = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ upstreamBranch: "origin/main" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.patches[0].upstreamBranch).toBe("origin/main");
        });

        it("should sort patches by timestamp descending", async () => {
            const response = await request(app).get("/patches").set("x-test-username", "Alice").expect(200);

            const timestamps = response.body.patches.map((p: StoredPatch) => p.timestamp);
            const sortedTimestamps = [...timestamps].sort((a, b) => b.localeCompare(a));
            expect(timestamps).toEqual(sortedTimestamps);
        });

        it("should filter patches by changeType", async () => {
            const response = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ changeType: "pending" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.patches[0].changeType).toBe("pending");
        });

        it("should filter patches by workingState", async () => {
            const response = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ workingState: "unstaged" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.patches[0].workingState).toBe("unstaged");
        });

        it("should filter patches by commitSha", async () => {
            const response = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ commitSha: "abc123def" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.patches[0].commitSha).toBe("abc123def");
        });
    });

    describe("POST /patches/sync", () => {
        it("should replace existing patches for user and repository", async () => {
            const stalePatch: PatchDto = {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Alice",
                repositoryFilePath: "src/stale.ts",
                baseCommit: "old123",
                patch: "diff --git a/src/stale.ts b/src/stale.ts\n...",
                timestamp: new Date(Date.now() - 1000).toISOString(),
            };

            await request(app).post("/patches").set("x-test-username", "Alice").send(stalePatch).expect(200);

            await request(app)
                .post("/patches/sync")
                .set("x-test-username", "Alice")
                .send({
                    repositoryRemoteUrl: "https://github.com/org/repo.git",
                    userName: "Alice",
                    patches: [
                        {
                            repositoryFilePath: "src/current.ts",
                            baseCommit: "new123",
                            patch: "diff --git a/src/current.ts b/src/current.ts\n...",
                            timestamp: new Date().toISOString(),
                        },
                    ],
                })
                .expect(200);

            const patchesResponse = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ repositoryRemoteUrl: "https://github.com/org/repo.git", userName: "Alice" })
                .expect(200);

            expect(patchesResponse.body.count).toBe(1);
            expect(patchesResponse.body.patches[0].repositoryFilePath).toBe("src/current.ts");
        });

        it("should only replace patches for matching user and repository", async () => {
            const alicePatch: PatchDto = {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Alice",
                repositoryFilePath: "src/alice.ts",
                baseCommit: "abc123",
                patch: "diff --git a/src/alice.ts b/src/alice.ts\n...",
                timestamp: new Date().toISOString(),
            };
            const bobPatch: PatchDto = {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Bob",
                repositoryFilePath: "src/bob.ts",
                baseCommit: "def456",
                patch: "diff --git a/src/bob.ts b/src/bob.ts\n...",
                timestamp: new Date().toISOString(),
            };

            await request(app).post("/patches").set("x-test-username", "Alice").send(alicePatch).expect(200);
            await request(app).post("/patches").set("x-test-username", "Bob").send(bobPatch).expect(200);

            await request(app)
                .post("/patches/sync")
                .set("x-test-username", "Alice")
                .send({
                    repositoryRemoteUrl: "https://github.com/org/repo.git",
                    userName: "Alice",
                    patches: [],
                })
                .expect(200);

            const allPatches = await request(app).get("/patches").set("x-test-username", "Alice").expect(200);
            const alicePatches = allPatches.body.patches.filter((patch: StoredPatch) => patch.userName === "Alice");
            const bobPatches = allPatches.body.patches.filter((patch: StoredPatch) => patch.userName === "Bob");

            expect(alicePatches).toHaveLength(0);
            expect(bobPatches).toHaveLength(1);
        });

        it("should accept SharedPatch-compatible items with repository and user fields", async () => {
            await request(app)
                .post("/patches/sync")
                .set("x-test-username", "Alice")
                .send({
                    repositoryRemoteUrl: "https://github.com/org/repo.git",
                    userName: "Alice",
                    patches: [
                        {
                            repositoryRemoteUrl: "https://github.com/org/repo.git",
                            userName: "Alice",
                            repositoryFilePath: "src/shared-shape.ts",
                            baseCommit: "abc999",
                            patch: "diff --git a/src/shared-shape.ts b/src/shared-shape.ts\n...",
                            timestamp: new Date().toISOString(),
                            committed: false,
                        },
                    ],
                })
                .expect(200);

            const response = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ repositoryRemoteUrl: "https://github.com/org/repo.git", userName: "Alice" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.patches[0].repositoryFilePath).toBe("src/shared-shape.ts");
        });

        it("should resolve repository and user from patch items when request-level fields are missing", async () => {
            await request(app)
                .post("/patches/sync")
                .set("x-test-username", "Alice")
                .send({
                    patches: [
                        {
                            repositoryRemoteUrl: "https://github.com/org/repo.git",
                            userName: "Alice",
                            repositoryFilePath: "src/item-level.ts",
                            baseCommit: "item123",
                            patch: "diff --git a/src/item-level.ts b/src/item-level.ts\n...",
                            timestamp: new Date().toISOString(),
                        },
                    ],
                })
                .expect(200);

            const response = await request(app)
                .get("/patches")
                .set("x-test-username", "Alice")
                .query({ repositoryRemoteUrl: "https://github.com/org/repo.git", userName: "Alice" })
                .expect(200);

            expect(response.body.count).toBe(1);
            expect(response.body.patches[0].repositoryFilePath).toBe("src/item-level.ts");
        });
    });

    describe("GET /files", () => {
        beforeEach(async () => {
            // Seed activities for Alice and Bob using per-user headers.
            await request(app)
                .post("/activities")
                .set("x-test-username", "Alice")
                .send({
                    activities: [
                        {
                            filePath: "/src/index.ts",
                            userName: "Alice",
                            timestamp: new Date().toISOString(),
                            action: "open",
                            repositoryRemoteUrl: "https://github.com/org/repo.git",
                            upstreamBranch: "origin/main",
                        },
                    ],
                });
            await request(app)
                .post("/activities")
                .set("x-test-username", "Bob")
                .send({
                    activities: [
                        {
                            filePath: "/src/index.ts",
                            userName: "Bob",
                            timestamp: new Date().toISOString(),
                            action: "edit",
                            repositoryRemoteUrl: "https://github.com/org/repo.git",
                            upstreamBranch: "origin/main",
                        },
                    ],
                });

            // Seed a patch for the file
            const patch: PatchDto = {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Alice",
                upstreamBranch: "origin/main",
                repositoryFilePath: "/src/index.ts",
                baseCommit: "abc123",
                patch: "diff --git a/src/index.ts b/src/index.ts\\n...",
                timestamp: new Date().toISOString(),
            };
            await request(app).post("/patches").set("x-test-username", "Alice").send(patch);
        });

        it("should return files organized by repository with correct response type", async () => {
            const response = await request(app).get("/files").set("x-test-username", "Alice").expect(200);

            // Validate response structure
            expect(response.body).toHaveProperty("count");
            expect(response.body).toHaveProperty("repositories");
            expect(Array.isArray(response.body.repositories)).toBe(true);

            // Validate response conforms to GetFilesResponse type
            const getResponse = plainToClass(GetFilesResponse, response.body);
            const errors = await validate(getResponse);
            expect(errors).toHaveLength(0);
        });

        it("should include active users for each file", async () => {
            const response = await request(app).get("/files").set("x-test-username", "Alice").expect(200);

            const repo = response.body.repositories[0];
            expect(repo.files).toHaveLength(1); // Only index.ts has active users
            expect(repo.files[0].activeUsers).toContain("Alice");
            expect(repo.files[0].activeUsers).toContain("Bob");
        });

        it("should include patch count for each file", async () => {
            const response = await request(app).get("/files").set("x-test-username", "Alice").expect(200);

            const repo = response.body.repositories[0];
            expect(repo.files[0].patchCount).toBe(1);
            expect(repo.files[0].patches).toHaveLength(1);
        });

        it("should match repository-relative patches to absolute activity file paths", async () => {
            const absoluteActivityBatch: ActivityBatchDto = {
                activities: [
                    {
                        filePath: "/workspace/repo/src/feature.ts",
                        userName: "Dana",
                        timestamp: new Date().toISOString(),
                        action: "open",
                        repositoryRemoteUrl: "https://github.com/org/repo.git",
                        upstreamBranch: "origin/main",
                    },
                ],
            };
            await request(app)
                .post("/activities")
                .set("x-test-username", "Dana")
                .send(absoluteActivityBatch)
                .expect(200);

            const relativePatch: PatchDto = {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Dana",
                upstreamBranch: "origin/main",
                repositoryFilePath: "src/feature.ts",
                baseCommit: "def456",
                patch: "diff --git a/src/feature.ts b/src/feature.ts\n...",
                timestamp: new Date().toISOString(),
            };
            await request(app).post("/patches").set("x-test-username", "Dana").send(relativePatch).expect(200);

            const response = await request(app).get("/files").set("x-test-username", "Alice").expect(200);
            const repo = response.body.repositories[0];
            const featureFile = repo.files.find(
                (file: { repositoryFilePath: string }) => file.repositoryFilePath === "src/feature.ts",
            );

            expect(featureFile).toBeDefined();
            expect(featureFile.patchCount).toBe(1);
            expect(featureFile.patches).toHaveLength(1);
        });

        it("should extract repository and file names correctly", async () => {
            const response = await request(app).get("/files").set("x-test-username", "Alice").expect(200);

            const repo = response.body.repositories[0];
            expect(repo.repositoryName).toBe("repo"); // .git extension is removed
            expect(repo.files[0].repositoryFileName).toBe("index.ts");
        });

        it("should filter files by repositoryRemoteUrl", async () => {
            const response = await request(app)
                .get("/files")
                .set("x-test-username", "Alice")
                .query({ repositoryRemoteUrl: "https://github.com/org/repo.git" })
                .expect(200);

            expect(response.body.repositories).toHaveLength(1);
            expect(response.body.repositories[0].repositoryRemoteUrl).toBe("https://github.com/org/repo.git");
        });

        it("should filter files by upstreamBranch", async () => {
            const response = await request(app)
                .get("/files")
                .set("x-test-username", "Alice")
                .query({ upstreamBranch: "origin/main" })
                .expect(200);

            expect(response.body.repositories).toHaveLength(1);
            expect(response.body.repositories[0].upstreamBranch).toBe("origin/main");
        });

        it("should keep separate repository groups for different upstream branches", async () => {
            await request(app)
                .post("/activities")
                .set("x-test-username", "Charlie")
                .send({
                    activities: [
                        {
                            filePath: "/src/branch.ts",
                            userName: "Charlie",
                            timestamp: new Date(Date.now() + 1000).toISOString(),
                            action: "open",
                            repositoryRemoteUrl: "https://github.com/org/repo.git",
                            upstreamBranch: "origin/release",
                        },
                    ],
                })
                .expect(200);

            const response = await request(app).get("/files").set("x-test-username", "Alice").expect(200);

            expect(response.body.repositories).toHaveLength(2);
            expect(
                response.body.repositories.map((repo: { upstreamBranch?: string }) => repo.upstreamBranch).sort(),
            ).toEqual(["origin/main", "origin/release"]);
        });

        it("should only include files with active users", async () => {
            // Close the file for Alice and Bob using per-user headers.
            await request(app)
                .post("/activities")
                .set("x-test-username", "Alice")
                .send({
                    activities: [
                        {
                            filePath: "/src/index.ts",
                            userName: "Alice",
                            timestamp: new Date().toISOString(),
                            action: "close",
                            repositoryRemoteUrl: "https://github.com/org/repo.git",
                            upstreamBranch: "origin/main",
                        },
                    ],
                });
            await request(app)
                .post("/activities")
                .set("x-test-username", "Bob")
                .send({
                    activities: [
                        {
                            filePath: "/src/index.ts",
                            userName: "Bob",
                            timestamp: new Date().toISOString(),
                            action: "close",
                            repositoryRemoteUrl: "https://github.com/org/repo.git",
                            upstreamBranch: "origin/main",
                        },
                    ],
                });

            const response = await request(app).get("/files").set("x-test-username", "Alice").expect(200);

            // Should return no repositories since no files have active users
            expect(response.body.count).toBe(0);
            expect(response.body.repositories).toHaveLength(0);
        });

        it("should sort files by last activity timestamp", async () => {
            // Add activity for another file
            const activityBatch: ActivityBatchDto = {
                activities: [
                    {
                        filePath: "/src/app.ts",
                        userName: "Charlie",
                        timestamp: new Date(Date.now() + 1000).toISOString(), // Newer
                        action: "open",
                        repositoryRemoteUrl: "https://github.com/org/repo.git",
                        upstreamBranch: "origin/main",
                    },
                ],
            };
            await request(app).post("/activities").set("x-test-username", "Charlie").send(activityBatch);

            const response = await request(app).get("/files").set("x-test-username", "Alice").expect(200);

            const repo = response.body.repositories[0];
            expect(repo.files).toHaveLength(2);
            // First file should be the most recently active (app.ts)
            expect(repo.files[0].repositoryFilePath).toBe("/src/app.ts");
        });
    });

    describe("Type Validation", () => {
        it("should validate ActivityDto structure", async () => {
            const activity = plainToClass(ActivityDto, {
                filePath: "/src/index.ts",
                userName: "Alice",
                timestamp: new Date().toISOString(),
                action: "open",
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                upstreamBranch: "origin/main",
            });

            const errors = await validate(activity);
            expect(errors).toHaveLength(0);
        });

        it("should reject invalid ActivityDto", async () => {
            const invalidActivity = plainToClass(ActivityDto, {
                filePath: 123, // Should be string
                userName: "Alice",
                timestamp: new Date().toISOString(),
                action: "invalid",
                repositoryRemoteUrl: "https://github.com/org/repo.git",
            });

            const errors = await validate(invalidActivity);
            expect(errors.length).toBeGreaterThan(0);
        });

        it("should validate PatchDto structure", async () => {
            const patch = plainToClass(PatchDto, {
                repositoryRemoteUrl: "https://github.com/org/repo.git",
                userName: "Alice",
                upstreamBranch: "origin/main",
                repositoryFilePath: "src/index.ts",
                baseCommit: "abc123",
                patch: "diff content",
                timestamp: new Date().toISOString(),
            });

            const errors = await validate(patch);
            expect(errors).toHaveLength(0);
        });
    });
});
