import "reflect-metadata";
import express from "express";
import cors from "cors";
import path from "path";
import { promises as fs } from "fs";
import { useExpressServer } from "routing-controllers";
import { ActivityController } from "./controllers/ActivityController";
import { HealthCheckResponse } from "@work-share/types";

/**
 * Main Express application for the Work Share activity API.
 */
const app = express();
const PORT = process.env.PORT || 3000;

interface VsixInfoResponse {
    available: boolean;
    fileName?: string;
    downloadUrl?: string;
    message?: string;
}

const sharedVsixDirectory = process.env.WORK_SHARE_VSIX_DIR || path.join(process.cwd(), "shared/vsix");

async function findLatestVsixFile(): Promise<string | undefined> {
    const candidateDirectories = [
        sharedVsixDirectory,
        path.join(process.cwd(), "@markusse/vs-code-plugins/work-share/extension"),
        path.join(process.cwd(), "vs-code-plugins/work-share/extension"),
        path.join(__dirname, "../../vs-code-plugins/work-share/extension"),
        path.join(__dirname, "../../../vs-code-plugins/work-share/extension"),
    ];

    let latestFilePath: string | undefined;
    let latestMtime = 0;

    for (const directory of candidateDirectories) {
        let entries: string[];
        try {
            entries = await fs.readdir(directory);
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.endsWith(".vsix")) {
                continue;
            }

            const fullPath = path.join(directory, entry);
            try {
                const stat = await fs.stat(fullPath);
                if (stat.isFile() && stat.mtimeMs > latestMtime) {
                    latestMtime = stat.mtimeMs;
                    latestFilePath = fullPath;
                }
            } catch {
                // Ignore files that disappear or are inaccessible while scanning.
            }
        }
    }

    return latestFilePath;
}

// Enable CORS for VS Code extension
app.use(cors());

// Setup routing-controllers
useExpressServer(app, {
    controllers: [ActivityController],
    defaultErrorHandler: true,
    routePrefix: "",
});

// Health check endpoint
app.get("/health", (req, res) => {
    const response: HealthCheckResponse = {
        status: "ok",
        timestamp: new Date().toISOString(),
    };
    res.json(response);
});

// Returns VSIX availability metadata for the landing page.
app.get("/downloads/vsix-info", async (req, res) => {
    const vsixPath = await findLatestVsixFile();
    if (!vsixPath) {
        const response: VsixInfoResponse = {
            available: false,
            message: "No packaged VSIX found. Run npm run package from the workspace root.",
        };
        res.status(404).json(response);
        return;
    }

    const response: VsixInfoResponse = {
        available: true,
        fileName: path.basename(vsixPath),
        downloadUrl: "/downloads/work-share.vsix",
    };
    res.json(response);
});

// Downloads the latest available VSIX package.
app.get("/downloads/work-share.vsix", async (req, res) => {
    const vsixPath = await findLatestVsixFile();
    if (!vsixPath) {
        res.status(404).json({
            message: "No packaged VSIX found. Run npm run package from the workspace root.",
        });
        return;
    }

    res.download(vsixPath, path.basename(vsixPath));
});

// Serve static files from the React app
const publicPath = path.join(__dirname, "../public");
app.use(express.static(publicPath));

// Catch-all route to serve React index.html for client-side routing (must be last)
app.get("*", (req, res) => {
    // Only send index.html if no previous handler has responded
    if (!res.headersSent) {
        res.sendFile(path.join(publicPath, "index.html"));
    }
});

/**
 * Starts the HTTP server and logs endpoint information.
 */
app.listen(PORT, () => {
    console.log(`Work Share server running on http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`VSIX directory: ${sharedVsixDirectory}`);
});

export default app;
