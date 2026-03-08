import * as vscode from "vscode";
import { createHash } from "crypto";
import { SharedPatch } from "../sharedPatch";
import { ApiClient } from "../apiClient";
import { OutputLogger } from "../outputLogger";
import { isGitInternalPath } from "./pathUtils";
import { GitContextService } from "./gitContext";
import { UserIdentityService } from "./identityService";

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

        const repositoryRootPath = repository.rootUri.fsPath;
        const baseCommitResult = await this.gitContext.runGitCommand(repositoryRootPath, ["rev-parse", "HEAD"]);
        if (baseCommitResult.exitCode !== 0) {
            this.logger?.warn("Patch sync skipped: could not resolve base commit.", {
                repositoryRemoteUrl,
                stderr: baseCommitResult.stderr,
            });
            return [];
        }

        const baseCommit = baseCommitResult.stdout.trim();
        const changedFilesResult = await this.gitContext.runGitCommand(repositoryRootPath, ["diff", "--name-only"]);
        if (changedFilesResult.exitCode !== 0) {
            this.logger?.warn("Patch sync skipped: could not list changed files.", {
                repositoryRemoteUrl,
                stderr: changedFilesResult.stderr,
            });
            return [];
        }

        const repositoryFilePaths = changedFilesResult.stdout
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);

        const activePatches: SharedPatch[] = [];
        for (const repositoryFilePath of repositoryFilePaths) {
            const patchResult = await this.gitContext.runGitCommand(repositoryRootPath, [
                "diff",
                "--",
                repositoryFilePath,
            ]);

            if (patchResult.exitCode !== 0 || !patchResult.stdout.trim()) {
                continue;
            }

            activePatches.push({
                repositoryRemoteUrl,
                userName,
                repositoryFilePath,
                baseCommit,
                patch: patchResult.stdout,
                timestamp: new Date(),
            });

            const absoluteFilePath = `${repositoryRootPath}/${repositoryFilePath}`.replace(/\\/g, "/");
            const patchDigest = createHash("sha256")
                .update(baseCommit)
                .update("\n")
                .update(patchResult.stdout)
                .digest("hex");
            this.lastSharedPatchDigestByFile.set(absoluteFilePath, patchDigest);
        }

        this.logger?.info("Patch sync active set built.", {
            repositoryRemoteUrl,
            userName,
            activePatchCount: activePatches.length,
        });

        return activePatches;
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
        const baseCommitResult = await this.gitContext.runGitCommand(repositoryRootPath, ["rev-parse", "HEAD"]);
        if (baseCommitResult.exitCode !== 0) {
            this.logger?.error("Patch sharing failed: could not resolve base commit.", {
                filePath,
                stderr: baseCommitResult.stderr,
            });
            return;
        }

        const baseCommit = baseCommitResult.stdout.trim();
        const patchResult = await this.gitContext.runGitCommand(repositoryRootPath, ["diff", "--", repositoryFilePath]);
        if (patchResult.exitCode !== 0) {
            this.logger?.error("Patch sharing failed: git diff command failed.", {
                filePath,
                repositoryFilePath,
                stderr: patchResult.stderr,
            });
            return;
        }

        const patchText = patchResult.stdout;
        if (!patchText.trim()) {
            this.logger?.info("Patch sharing skipped: no unstaged diff to share.", { repositoryFilePath });
            return;
        }

        const patchDigest = createHash("sha256").update(baseCommit).update("\n").update(patchText).digest("hex");

        if (this.lastSharedPatchDigestByFile.get(filePath) === patchDigest) {
            this.logger?.info("Patch sharing skipped: duplicate patch digest.", { repositoryFilePath });
            return;
        }

        this.lastSharedPatchDigestByFile.set(filePath, patchDigest);

        this.logger?.info("Patch generated for sharing.", {
            repositoryRemoteUrl,
            repositoryFilePath,
            baseCommit,
            patchLength: patchText.length,
            patchDigest,
        });

        await this.apiClient.sendPatch({
            repositoryRemoteUrl,
            userName,
            repositoryFilePath,
            baseCommit,
            patch: patchText,
            timestamp: new Date(),
        });
    }
}
