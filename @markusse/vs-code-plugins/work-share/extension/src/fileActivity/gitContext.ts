import * as vscode from "vscode";
import * as path from "path";
import { spawn } from "child_process";
import { GitApi, GitExtensionExports, GitRepository } from "./gitTypes";
import { GitCommandResult } from "./types";

/**
 * Provides git repository resolution and command helpers for activity tracking.
 */
export class GitContextService {
    private gitApi: GitApi | undefined;
    private gitInitializationPromise: Promise<void> | undefined;

    /**
     * Returns configured git command timeout in milliseconds.
     */
    private getGitCommandTimeoutMs(): number {
        const configuredTimeout = vscode.workspace
            .getConfiguration("workShare")
            .get<number>("gitCommandTimeoutMs", 30000);
        return Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 30000;
    }

    public async initialize(): Promise<void> {
        if (this.gitInitializationPromise) {
            return this.gitInitializationPromise;
        }

        this.gitInitializationPromise = (async () => {
            try {
                const gitExtension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
                if (!gitExtension) {
                    return;
                }

                if (!gitExtension.isActive) {
                    await gitExtension.activate();
                }

                this.gitApi = gitExtension.exports.getAPI(1);
            } catch (error) {
                console.error("Failed to initialize git context:", error);
            }
        })();

        return this.gitInitializationPromise;
    }

    get api(): GitApi | undefined {
        return this.gitApi;
    }

    public resolveRepositoryForFile(filePath: string): GitRepository | undefined {
        if (!this.gitApi || this.gitApi.repositories.length === 0) {
            return undefined;
        }

        const normalizedFilePath = filePath.replace(/\\/g, "/");
        return this.gitApi.repositories.find((repository) => {
            const repositoryPath = repository.rootUri.fsPath.replace(/\\/g, "/");
            return normalizedFilePath === repositoryPath || normalizedFilePath.startsWith(`${repositoryPath}/`);
        });
    }

    public resolveWorkspaceRepository(): GitRepository | undefined {
        if (!this.gitApi || this.gitApi.repositories.length === 0) {
            return undefined;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        for (const workspaceFolder of workspaceFolders) {
            const workspacePath = workspaceFolder.uri.fsPath.replace(/\\/g, "/");
            const matchingRepository = this.gitApi.repositories.find((repository) => {
                const repositoryPath = repository.rootUri.fsPath.replace(/\\/g, "/");
                return repositoryPath === workspacePath || workspacePath.startsWith(`${repositoryPath}/`);
            });

            if (matchingRepository) {
                return matchingRepository;
            }
        }

        return this.gitApi.repositories[0];
    }

    public getFirstRepository(): GitRepository | undefined {
        return this.gitApi?.repositories?.[0];
    }

    public resolveRepositoryByRootPath(repositoryRootPath: string): GitRepository | undefined {
        if (!this.gitApi || this.gitApi.repositories.length === 0) {
            return undefined;
        }

        const normalizedRootPath = repositoryRootPath.replace(/\\/g, "/");
        return this.gitApi.repositories.find(
            (repository) => repository.rootUri.fsPath.replace(/\\/g, "/") === normalizedRootPath,
        );
    }

    public async getRepositoryRemoteUrlForRepository(repository: GitRepository): Promise<string | undefined> {
        try {
            const remoteFromConfig = await repository.getConfig("remote.origin.url");
            if (remoteFromConfig) {
                return remoteFromConfig;
            }
        } catch (error) {
            console.error("Failed to read remote origin URL from git config:", error);
        }

        const originRemote = repository.state?.remotes?.find((remote) => remote.name === "origin");
        return originRemote?.fetchUrl ?? originRemote?.pushUrl;
    }

    public async getRepositoryRemoteUrl(filePath: string): Promise<string | undefined> {
        await this.initialize();
        const repository = this.resolveRepositoryForFile(filePath);
        if (!repository) {
            return undefined;
        }

        return this.getRepositoryRemoteUrlForRepository(repository);
    }

    public async getRepositories(): Promise<GitRepository[] | undefined> {
        await this.initialize();
        if (!this.gitApi || this.gitApi.repositories.length === 0) {
            return undefined;
        }

        return this.gitApi.repositories;
    }

    public getRepositoryRelativeFilePath(filePath: string): string | undefined {
        const repository = this.resolveRepositoryForFile(filePath);
        if (!repository) {
            return undefined;
        }

        return path.relative(repository.rootUri.fsPath, filePath).replace(/\\/g, "/");
    }

    public async resolveRepositoryByRemoteUrl(repositoryRemoteUrl: string): Promise<GitRepository | undefined> {
        await this.initialize();
        if (!this.gitApi) {
            return undefined;
        }

        for (const repository of this.gitApi.repositories) {
            const remoteUrl = await this.getRepositoryRemoteUrlForRepository(repository);
            if (remoteUrl === repositoryRemoteUrl) {
                return repository;
            }
        }

        return undefined;
    }

    public async isFileIgnoredByGit(filePath: string): Promise<boolean> {
        await this.initialize();
        const repository = this.resolveRepositoryForFile(filePath);
        if (!repository) {
            return false;
        }

        try {
            return await repository.isIgnored(vscode.Uri.file(filePath));
        } catch (error) {
            console.error("Failed to check if file is ignored:", error);
            return false;
        }
    }

    /**
     * Attempts to fetch a remote using the VS Code Git API, which can leverage configured credential helpers.
     *
     * PREFERRED METHOD for git operations requiring authentication (fetch, push, pull).
     * The Git API uses VS Code's configured authentication mechanisms, avoiding password prompts
     * and properly handling SSH keys, credential managers, and OAuth tokens.
     *
     * Use this instead of runGitCommand() for any operation that might require network authentication.
     */
    public async fetchRemoteViaGitApi(repositoryRootPath: string, remoteName: string): Promise<GitCommandResult> {
        await this.initialize();
        const repository = this.resolveRepositoryByRootPath(repositoryRootPath);
        if (!repository?.fetch) {
            return {
                stdout: "",
                stderr: "Git API fetch is not available for this repository.",
                exitCode: 1,
            };
        }

        try {
            await repository.fetch({ remote: remoteName });
            return {
                stdout: "",
                stderr: "",
                exitCode: 0,
            };
        } catch (error) {
            return {
                stdout: "",
                stderr: error instanceof Error ? error.message : String(error),
                exitCode: 1,
            };
        }
    }

    /**
     * Runs a git command in a target directory.
     * Always resolves with a result containing stdout, stderr, and exitCode.
     * Spawn errors (e.g., git not found) resolve with exitCode 127.
     * Timeouts resolve with exitCode 124.
     *
     * IMPORTANT: This method is for LOCAL git operations only (diff, show, merge-base, etc.).
     * For operations requiring authentication (fetch, push, pull), use fetchRemoteViaGitApi()
     * to leverage VS Code's configured authentication and avoid password prompts.
     *
     * Environment variables ensure non-interactive execution:
     * - GIT_TERMINAL_PROMPT=0: Disables terminal password prompts
     * - GCM_INTERACTIVE=Never: Disables Git Credential Manager interactive prompts
     * - GIT_ASKPASS=echo: Returns empty string if auth is somehow requested
     * - stdin=ignore: Prevents any keyboard input
     */
    public async runGitCommand(workingDirectory: string, args: string[]): Promise<GitCommandResult> {
        return new Promise((resolve) => {
            const timeoutMs = this.getGitCommandTimeoutMs();
            let stdout = "";
            let stderr = "";
            let settled = false;

            const resolveOnce = (result: GitCommandResult) => {
                if (settled) {
                    return;
                }

                settled = true;
                resolve(result);
            };

            const gitProcessEnv: NodeJS.ProcessEnv = {
                ...process.env,
            };
            // Disable all forms of interactive authentication prompts
            gitProcessEnv.GIT_TERMINAL_PROMPT = "0";
            gitProcessEnv.GCM_INTERACTIVE = "Never";
            gitProcessEnv.GIT_ASKPASS = "echo"; // Return empty string if askpass is invoked

            const childProcess = spawn("git", args, {
                cwd: workingDirectory,
                stdio: ["ignore", "pipe", "pipe"], // stdin ignored - no interactive input possible
                env: gitProcessEnv,
            });

            const timeoutHandle = setTimeout(() => {
                childProcess.kill("SIGTERM");
                resolveOnce({
                    stdout,
                    stderr: `${stderr}\nGit command timed out after ${timeoutMs}ms: git ${args.join(" ")}`.trim(),
                    exitCode: 124,
                });
            }, timeoutMs);

            childProcess.stdout.on("data", (data: Buffer) => {
                stdout += data.toString();
            });

            childProcess.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
            });

            childProcess.on("error", (error: Error) => {
                clearTimeout(timeoutHandle);
                resolveOnce({
                    stdout: "",
                    stderr: `Failed to spawn git command: ${error.message}`,
                    exitCode: 127,
                });
            });

            childProcess.on("close", (exitCode) => {
                clearTimeout(timeoutHandle);
                resolveOnce({
                    stdout,
                    stderr,
                    exitCode: exitCode ?? 1,
                });
            });
        });
    }
}
