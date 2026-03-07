import * as vscode from "vscode";
import { OutputLogger } from "../outputLogger";
import { GitRepository } from "./gitTypes";
import { GitContextService } from "./gitContext";
import { FileActivityAction } from "./types";

/**
 * Resolves and validates user identity used for activity and patch payloads.
 */
export class UserIdentityService {
    private gitUserName: string | undefined;
    private identityWarningShown = false;
    private lastIdentityBlockedLogAt = 0;

    constructor(
        private gitContext: GitContextService,
        private logger?: OutputLogger,
    ) {}

    public async initialize(): Promise<void> {
        await this.gitContext.initialize();
        const repository = this.gitContext.getFirstRepository();
        if (repository) {
            await this.updateGitUserName(repository);
        }
    }

    public async getCurrentUserName(filePath?: string): Promise<string> {
        await this.ensureGitUserName(filePath);
        return this.getResolvedUserName();
    }

    public async resolveIdentifiedUserName(filePath?: string): Promise<string | undefined> {
        await this.ensureGitUserName(filePath);
        const userName = this.getResolvedUserName();
        if (this.isIdentifiedUserName(userName)) {
            this.identityWarningShown = false;
            return userName;
        }

        if (!this.identityWarningShown) {
            this.identityWarningShown = true;
            const message = "Work Share: User identity is required. Set workShare.userName or git user.name.";
            vscode.window.showWarningMessage(message);
            this.logger?.warn("Activity/patch publish blocked: missing user identity.", {
                configuredUserName: this.getConfiguredUserName(),
                gitUserName: this.gitUserName,
            });
        }

        return undefined;
    }

    public logIdentityBlockedActivity(filePath: string, action: FileActivityAction): void {
        const now = Date.now();
        if (now - this.lastIdentityBlockedLogAt < 5000) {
            return;
        }

        this.lastIdentityBlockedLogAt = now;
        this.logger?.warn("Activity tracking skipped: missing user identity.", {
            filePath,
            action,
            configuredUserName: this.getConfiguredUserName(),
            gitUserName: this.gitUserName,
        });
    }

    public resetWarnings(): void {
        this.identityWarningShown = false;
    }

    private getConfiguredUserName(): string | undefined {
        return vscode.workspace.getConfiguration("workShare").get<string>("userName")?.trim();
    }

    private getResolvedUserName(): string {
        const configuredName = this.getConfiguredUserName();
        if (configuredName) {
            return configuredName;
        }

        if (this.gitUserName?.trim()) {
            return this.gitUserName;
        }

        return "Unknown User";
    }

    /**
     * Returns true when the user identity is explicit and acceptable for server ingestion.
     */
    private isIdentifiedUserName(userName: string): boolean {
        const normalized = userName.trim().toLowerCase();
        return !!normalized && normalized !== "unknown user" && normalized !== "unknown";
    }

    /**
     * Ensures git user identity is resolved before emitting activity/patch events.
     */
    private async ensureGitUserName(filePath?: string): Promise<void> {
        if (this.gitUserName?.trim()) {
            return;
        }

        await this.gitContext.initialize();

        const repositoryFromFilePath = filePath ? this.gitContext.resolveRepositoryForFile(filePath) : undefined;
        const repository = repositoryFromFilePath ?? this.gitContext.resolveWorkspaceRepository();

        if (repository) {
            await this.updateGitUserName(repository);
            if (this.gitUserName?.trim()) {
                return;
            }
        }

        const fallbackWorkingDirectory =
            repository?.rootUri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!fallbackWorkingDirectory) {
            return;
        }

        const globalUserName = await this.resolveGitGlobalUserNameFromCli(fallbackWorkingDirectory);
        if (globalUserName) {
            this.gitUserName = globalUserName;
        }
    }

    private async updateGitUserName(repository: GitRepository): Promise<void> {
        try {
            const config = await repository.getConfig("user.name");
            if (config?.trim()) {
                this.gitUserName = config.trim();
                return;
            }

            const resolvedViaGit = await this.resolveGitUserNameFromCli(repository.rootUri.fsPath);
            if (resolvedViaGit) {
                this.gitUserName = resolvedViaGit;
                return;
            }

            const globalUserName = await this.resolveGitGlobalUserNameFromCli(repository.rootUri.fsPath);
            if (globalUserName) {
                this.gitUserName = globalUserName;
            }
        } catch (error) {
            console.error("Failed to get git user name:", error);
        }
    }

    /**
     * Resolves git user.name using repository context (local -> global lookup performed by git).
     */
    private async resolveGitUserNameFromCli(workingDirectory: string): Promise<string | undefined> {
        const result = await this.gitContext.runGitCommand(workingDirectory, ["config", "user.name"]);
        if (result.exitCode !== 0) {
            return undefined;
        }

        const userName = result.stdout.trim();
        return userName || undefined;
    }

    /**
     * Resolves global git user.name regardless of repository-local config.
     */
    private async resolveGitGlobalUserNameFromCli(workingDirectory: string): Promise<string | undefined> {
        const result = await this.gitContext.runGitCommand(workingDirectory, ["config", "--global", "user.name"]);
        if (result.exitCode !== 0) {
            return undefined;
        }

        const userName = result.stdout.trim();
        return userName || undefined;
    }
}
