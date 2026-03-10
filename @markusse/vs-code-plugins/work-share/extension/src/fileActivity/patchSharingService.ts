import * as vscode from "vscode";
import { createHash } from "crypto";
import * as path from "path";
import { SharedPatch } from "../sharedPatch";
import { ApiClient } from "../apiClient";
import { OutputLogger } from "../outputLogger";
import { isGitInternalPath } from "./pathUtils";
import { GitContextService } from "./gitContext";
import { UserIdentityService } from "./identityService";
import { GitRepository } from "./gitTypes";

/**
 * Generates and publishes repository-scoped patches on file save.
 */
export class PatchSharingService {
    private lastSharedPatchDigestByFile: Map<string, string> = new Map();

    constructor(
        private gitContext: GitContextService,
        private identityService: UserIdentityService,
        private apiClient: ApiClient,
        private logger?: OutputLogger,
    ) {}

    /**
     * Extracts the primary repository-relative file path from a unified diff.
     * Pending commit patches can span many files; this chooses a stable first path for indexing.
     */
    private extractPrimaryRepositoryFilePathFromPatch(patchText: string): string | undefined {
        const match = patchText.match(/^diff --git a\/(.+?) b\/(.+)$/m);
        if (!match) {
            return undefined;
        }

        return match[2]?.trim() || match[1]?.trim() || undefined;
    }

    /**
     * Builds a stable dedupe key for a file and working state.
     */
    private getFileStateDedupeKey(filePath: string, workingState: "staged" | "unstaged"): string {
        return `${filePath}:${workingState}`;
    }

    /**
     * Resolves commits that are ahead of the configured upstream branch, oldest first.
     */
    private async resolvePendingCommitShas(repository: GitRepository): Promise<string[]> {
        const upstream = repository.state?.HEAD?.upstream;
        if (!upstream?.remote || !upstream.name) {
            return [];
        }

        const upstreamRef = `${upstream.remote}/${upstream.name}`;
        const result = await this.gitContext.runGitCommand(repository.rootUri.fsPath, [
            "rev-list",
            "--reverse",
            `${upstreamRef}..HEAD`,
        ]);
        if (result.exitCode !== 0) {
            this.logger?.warn("Pending commit collection skipped: unable to list commits ahead of upstream.", {
                repositoryRootPath: repository.rootUri.fsPath,
                stderr: result.stderr,
            });
            return [];
        }

        return result.stdout
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }

    /**
     * Resolves the current HEAD commit hash, preferring Git API state and falling back to CLI.
     */
    private async resolveBaseCommit(repository: GitRepository): Promise<string | undefined> {
        const headCommit = repository.state?.HEAD?.commit?.trim();
        if (headCommit) {
            return headCommit;
        }

        const baseCommitResult = await this.gitContext.runGitCommand(repository.rootUri.fsPath, ["rev-parse", "HEAD"]);
        if (baseCommitResult.exitCode !== 0) {
            return undefined;
        }

        const baseCommit = baseCommitResult.stdout.trim();
        return baseCommit || undefined;
    }

    /**
     * Lists unstaged repository-relative file paths, preferring Git API state and falling back to CLI.
     */
    private async resolveChangedRepositoryFilePaths(
        repository: GitRepository,
        workingState: "staged" | "unstaged",
    ): Promise<string[]> {
        const rootPath = repository.rootUri.fsPath;
        const changes =
            workingState === "staged" ? repository.state?.indexChanges : repository.state?.workingTreeChanges;

        if (changes && changes.length > 0) {
            const filePathSet = new Set<string>();
            for (const change of changes) {
                const relativePath = path.relative(rootPath, change.uri.fsPath).replace(/\\/g, "/").trim();
                if (relativePath) {
                    filePathSet.add(relativePath);
                }
            }

            return Array.from(filePathSet.values());
        }

        const args = workingState === "staged" ? ["diff", "--cached", "--name-only"] : ["diff", "--name-only"];
        const changedFilesResult = await this.gitContext.runGitCommand(rootPath, args);
        if (changedFilesResult.exitCode !== 0) {
            return [];
        }

        return changedFilesResult.stdout
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }

    /**
     * Creates working patches for either staged or unstaged state.
     */
    private async buildWorkingPatchesForState(
        repository: GitRepository,
        repositoryRemoteUrl: string,
        userName: string,
        baseCommit: string,
        workingState: "staged" | "unstaged",
    ): Promise<SharedPatch[]> {
        const repositoryRootPath = repository.rootUri.fsPath;
        const repositoryFilePaths = await this.resolveChangedRepositoryFilePaths(repository, workingState);

        const patches: SharedPatch[] = [];
        for (const repositoryFilePath of repositoryFilePaths) {
            const diffArgs =
                workingState === "staged" ?
                    ["diff", "--cached", "--", repositoryFilePath]
                :   ["diff", "--", repositoryFilePath];
            const patchResult = await this.gitContext.runGitCommand(repositoryRootPath, diffArgs);

            if (patchResult.exitCode !== 0 || !patchResult.stdout.trim()) {
                continue;
            }

            const patchDigest = createHash("sha256")
                .update(baseCommit)
                .update("\n")
                .update(workingState)
                .update("\n")
                .update(patchResult.stdout)
                .digest("hex");

            patches.push({
                repositoryRemoteUrl,
                userName,
                repositoryFilePath,
                baseCommit,
                patch: patchResult.stdout,
                timestamp: new Date(),
                changeType: "working",
                workingState,
                contentHash: patchDigest,
            });

            const absoluteFilePath = `${repositoryRootPath}/${repositoryFilePath}`.replace(/\\/g, "/");
            const dedupeKey = this.getFileStateDedupeKey(absoluteFilePath, workingState);
            this.lastSharedPatchDigestByFile.set(dedupeKey, patchDigest);
        }

        return patches;
    }

    /**
     * Builds the complete set of active unstaged patches for a repository and user.
     */
    public async buildActivePatchesForRepository(
        repositoryRemoteUrl: string,
        userName: string,
    ): Promise<SharedPatch[]> {
        const repository = await this.gitContext.resolveRepositoryByRemoteUrl(repositoryRemoteUrl);
        if (!repository) {
            this.logger?.warn("Patch sync skipped: repository not found for remote URL.", {
                repositoryRemoteUrl,
            });
            return [];
        }

        return this.buildActivePatchesForResolvedRepository(repository, repositoryRemoteUrl, userName);
    }

    /**
     * Builds the complete set of active unstaged patches for a resolved repository and user.
     */
    public async buildActivePatchesForResolvedRepository(
        repository: GitRepository,
        repositoryRemoteUrl: string,
        userName: string,
    ): Promise<SharedPatch[]> {
        const baseCommit = await this.resolveBaseCommit(repository);
        if (!baseCommit) {
            this.logger?.warn("Patch sync skipped: could not resolve base commit.", {
                repositoryRemoteUrl,
            });
            return [];
        }
        const stagedPatches = await this.buildWorkingPatchesForState(
            repository,
            repositoryRemoteUrl,
            userName,
            baseCommit,
            "staged",
        );
        const unstagedPatches = await this.buildWorkingPatchesForState(
            repository,
            repositoryRemoteUrl,
            userName,
            baseCommit,
            "unstaged",
        );
        const activePatches = [...stagedPatches, ...unstagedPatches];

        this.logger?.info("Patch sync active set built.", {
            repositoryRemoteUrl,
            userName,
            activePatchCount: activePatches.length,
        });

        return activePatches;
    }

    /**
     * Builds one patch per local commit that is ahead of upstream (`upstream..HEAD`).
     */
    public async buildPendingCommitPatchesForResolvedRepository(
        repository: GitRepository,
        repositoryRemoteUrl: string,
        userName: string,
    ): Promise<SharedPatch[]> {
        const commitShas = await this.resolvePendingCommitShas(repository);
        if (commitShas.length === 0) {
            return [];
        }

        const pendingPatches: SharedPatch[] = [];
        for (const commitSha of commitShas) {
            const metadataResult = await this.gitContext.runGitCommand(repository.rootUri.fsPath, [
                "show",
                "-s",
                "--format=%H%x09%h%x09%s",
                commitSha,
            ]);
            if (metadataResult.exitCode !== 0) {
                continue;
            }

            const [fullSha, shortSha, ...messageParts] = metadataResult.stdout.trim().split("\t");
            const commitMessage = messageParts.join("\t").trim();

            const patchResult = await this.gitContext.runGitCommand(repository.rootUri.fsPath, [
                "show",
                "--binary",
                "--full-index",
                "--format=",
                fullSha || commitSha,
            ]);
            if (patchResult.exitCode !== 0 || !patchResult.stdout.trim()) {
                continue;
            }

            const repositoryFilePath =
                this.extractPrimaryRepositoryFilePathFromPatch(patchResult.stdout) || `commit/${shortSha || fullSha}`;
            const contentHash = createHash("sha256")
                .update(fullSha || commitSha)
                .update("\n")
                .update(patchResult.stdout)
                .digest("hex");

            pendingPatches.push({
                repositoryRemoteUrl,
                userName,
                repositoryFilePath,
                baseCommit: fullSha || commitSha,
                patch: patchResult.stdout,
                timestamp: new Date(),
                changeType: "pending",
                commitSha: fullSha || commitSha,
                commitShortSha: shortSha || (fullSha || commitSha).slice(0, 8),
                commitMessage,
                contentHash,
            });
        }

        this.logger?.info("Pending commit patch set built.", {
            repositoryRemoteUrl,
            userName,
            pendingPatchCount: pendingPatches.length,
        });

        return pendingPatches;
    }

    /**
     * Generates and shares a repository-relative patch for a saved file.
     */
    public async sharePatchForFile(filePath: string): Promise<void> {
        if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))) {
            this.logger?.info("Patch sharing skipped: file is outside workspace.", { filePath });
            return;
        }

        if (isGitInternalPath(filePath) || (await this.gitContext.isFileIgnoredByGit(filePath))) {
            this.logger?.info("Patch sharing skipped: file is git-internal or ignored.", { filePath });
            return;
        }

        const userName = await this.identityService.resolveIdentifiedUserName(filePath);
        if (!userName) {
            this.logger?.warn("Patch sharing skipped: missing user identity.", { filePath });
            return;
        }

        const repository = this.gitContext.resolveRepositoryForFile(filePath);
        if (!repository) {
            this.logger?.warn("Patch sharing skipped: no git repository resolved for file.", { filePath });
            return;
        }

        const repositoryRemoteUrl = await this.gitContext.getRepositoryRemoteUrlForRepository(repository);
        if (!repositoryRemoteUrl) {
            this.logger?.warn("Patch sharing skipped: repository remote URL not found.", { filePath });
            return;
        }

        const repositoryFilePath = this.gitContext.getRepositoryRelativeFilePath(filePath);
        if (!repositoryFilePath) {
            this.logger?.warn("Patch sharing skipped: unable to resolve repository-relative file path.", { filePath });
            return;
        }

        const repositoryRootPath = repository.rootUri.fsPath;
        const baseCommit = await this.resolveBaseCommit(repository);
        if (!baseCommit) {
            this.logger?.error("Patch sharing failed: could not resolve base commit.", {
                filePath,
            });
            return;
        }

        const workingStates: Array<"staged" | "unstaged"> = ["staged", "unstaged"];
        for (const workingState of workingStates) {
            const diffArgs =
                workingState === "staged" ?
                    ["diff", "--cached", "--", repositoryFilePath]
                :   ["diff", "--", repositoryFilePath];
            const patchResult = await this.gitContext.runGitCommand(repositoryRootPath, diffArgs);
            if (patchResult.exitCode !== 0) {
                this.logger?.error("Patch sharing failed: git diff command failed.", {
                    filePath,
                    repositoryFilePath,
                    workingState,
                    stderr: patchResult.stderr,
                });
                continue;
            }

            const patchText = patchResult.stdout;
            if (!patchText.trim()) {
                continue;
            }

            const patchDigest = createHash("sha256")
                .update(baseCommit)
                .update("\n")
                .update(workingState)
                .update("\n")
                .update(patchText)
                .digest("hex");
            const dedupeKey = this.getFileStateDedupeKey(filePath, workingState);
            if (this.lastSharedPatchDigestByFile.get(dedupeKey) === patchDigest) {
                this.logger?.info("Patch sharing skipped: duplicate patch digest.", {
                    repositoryFilePath,
                    workingState,
                });
                continue;
            }

            this.lastSharedPatchDigestByFile.set(dedupeKey, patchDigest);

            await this.apiClient.sendPatch({
                repositoryRemoteUrl,
                userName,
                repositoryFilePath,
                baseCommit,
                patch: patchText,
                timestamp: new Date(),
                changeType: "working",
                workingState,
                contentHash: patchDigest,
            });
        }
    }
}
