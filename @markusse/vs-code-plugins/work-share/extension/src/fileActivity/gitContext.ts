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
     * Runs a git command in a target directory.
     */
    public async runGitCommand(workingDirectory: string, args: string[]): Promise<GitCommandResult> {
        return new Promise((resolve, reject) => {
            const childProcess = spawn("git", args, {
                cwd: workingDirectory,
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";

            childProcess.stdout.on("data", (data: Buffer) => {
                stdout += data.toString();
            });

            childProcess.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
            });

            childProcess.on("error", reject);
            childProcess.on("close", (exitCode) => {
                resolve({
                    stdout,
                    stderr,
                    exitCode: exitCode ?? 1,
                });
            });
        });
    }
}
