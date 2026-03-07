import "reflect-metadata";
import express from "express";
import cors from "cors";
import { useExpressServer } from "routing-controllers";
import { ActivityController } from "./controllers/ActivityController";

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
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Starts the HTTP server and logs endpoint information.
 */
app.listen(PORT, () => {
    console.log(`Work Share server running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

export default app;
