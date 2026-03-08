import "reflect-metadata";
import express from "express";
import cors from "cors";
import path from "path";
import { useExpressServer } from "routing-controllers";
import { ActivityController } from "./controllers/ActivityController";
import { HealthCheckResponse } from "@work-share/types";

/**
 * Main Express application for the Work Share activity API.
 */
const app = express();
const PORT = process.env.PORT || 3000;

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
});

export default app;
