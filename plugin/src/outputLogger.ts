import * as vscode from "vscode";

/**
 * Lightweight output-channel logger for extension diagnostics.
 */
export class OutputLogger {
    constructor(private outputChannel: vscode.OutputChannel) {}

    public info(message: string, details?: unknown): void {
        this.write("INFO", message, details);
    }

    public warn(message: string, details?: unknown): void {
        this.write("WARN", message, details);
    }

    public error(message: string, details?: unknown): void {
        this.write("ERROR", message, details);
    }

    private write(level: "INFO" | "WARN" | "ERROR", message: string, details?: unknown): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);

        if (details !== undefined) {
            this.outputChannel.appendLine(this.stringifyDetails(details));
        }
    }

    private stringifyDetails(details: unknown): string {
        try {
            return JSON.stringify(details, null, 2);
        } catch {
            return String(details);
        }
    }
}
