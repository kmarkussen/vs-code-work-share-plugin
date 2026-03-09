import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { ApiClient } from "./apiClient";
import { SharedPatch } from "./sharedPatch";
import { OutputLogger } from "./outputLogger";
import { isGitInternalPath } from "./fileActivity/pathUtils";
import { ConflictStatus, FileActivity } from "./fileActivity/types";
import { GitContextService } from "./fileActivity/gitContext";
import { UserIdentityService } from "./fileActivity/identityService";
import { PatchSharingService } from "./fileActivity/patchSharingService";

export { isGitInternalPath } from "./fileActivity/pathUtils";
export type { ConflictStatus, FileActivity } from "./fileActivity/types";

/**
 * Tracks editor file events and reports repository-scoped activity to the server.
 */
export class FileActivityTracker {
    private disposables: vscode.Disposable[] = [];
    private activities: Map<string, FileActivity> = new Map();
    private updateTimer: NodeJS.Timeout | undefined;
    private remoteConflictTimer: NodeJS.Timeout | undefined;
    private lastRemoteFetchAtByRepositoryRoot = new Map<string, number>();
    private lastDetachedHeadWarningAtByRepositoryRoot = new Map<string, number>();
    private remoteConflictAvailabilityIssueByRepositoryRoot = new Map<string, string>();
    private gitContext: GitContextService;
    private identityService: UserIdentityService;
    private patchSharingService: PatchSharingService;
    private mergeViewTempDirectories: Set<string> = new Set();
    private patchSyncInFlightByRepository: Set<string> = new Set();
    private lastPatchSyncAtByRepositoryRemoteUrl: Map<string, number> = new Map();

    /**
     * Master list of conflicts for project files.
     * - undefined: conflict evaluation is incomplete
     * - empty array []: clean (no conflicts)
     * - array with entries: conflict sources (SharedPatch objects)
     */
    private projectFileConflicts: Map<string, SharedPatch[] | undefined> = new Map();

    private _onDidChangeConflictStatus: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeConflictStatus: vscode.Event<void> = this._onDidChangeConflictStatus.event;

    constructor(
        private context: vscode.ExtensionContext,
        private apiClient: ApiClient,
        private logger?: OutputLogger,
    ) {
        this.gitContext = new GitContextService();
        this.identityService = new UserIdentityService(this.gitContext, logger);
        this.patchSharingService = new PatchSharingService(
            this.gitContext,
            this.identityService,
            this.apiClient,
            logger,
        );
        void this.identityService.initialize();
    }

    /**
     * Resolves the active repository remote URL used for filtering visible activity.
     */
    public async getCurrentRepositoryRemoteUrl(): Promise<string | undefined> {
        await this.gitContext.initialize();

        const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (activeFilePath) {
            return this.gitContext.getRepositoryRemoteUrl(activeFilePath);
        }

        const firstActivity = this.activities.values().next().value as FileActivity | undefined;
        if (firstActivity) {
            return firstActivity.repositoryRemoteUrl;
        }

        const workspaceRepository = this.gitContext.resolveWorkspaceRepository();
        if (workspaceRepository) {
            return this.gitContext.getRepositoryRemoteUrlForRepository(workspaceRepository);
        }

        return undefined;
    }

    /**
     * Returns the resolved current user identity used for activity and patch payloads.
     */
    public async getCurrentUserName(filePath?: string): Promise<string> {
        return this.identityService.getCurrentUserName(filePath);
    }

    /**
     * Gets the repository-relative file path for reveal operations in tree view.
     */
    public getRepositoryRelativeFilePath(filePath: string): string | undefined {
        return this.gitContext.getRepositoryRelativeFilePath(filePath);
    }
    /**
     * Determines if the user is actively sharing (identity resolved and no connection issues).
     * Used by the tree view to display sharing status icon.
     */
    public async isActivelySharingActivity(): Promise<boolean> {
        const identifiedName = await this.identityService.resolveIdentifiedUserName();
        return !!identifiedName;
    }

    /**
     * Optionally checks conflicts after save based on user configuration.
     */
    private async autoCheckConflictsOnSave(filePath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration("workShare");
        const autoCheckEnabled = config.get<boolean>("autoCheckConflictsOnSave", false);
        if (!autoCheckEnabled) {
            return;
        }

        const status = await this.updateConflictStatusForFile(filePath);

        this.logger?.info("Auto conflict check on save completed.", { filePath, status });
        if (status === "conflict") {
            vscode.window.showWarningMessage(
                "Work Share: Possible incoming or remote-tracking merge conflict detected for saved file.",
            );
        }
    }

    /**
     * Returns the configured interval used for remote tracking conflict checks.
     * A non-positive value disables the background timer.
     */
    private getRemoteConflictCheckInterval(): number {
        const config = vscode.workspace.getConfiguration("workShare");
        return config.get<number>("remoteConflictCheckInterval", 60000);
    }

    /**
     * Detects expected auth failures from non-interactive git commands.
     */
    private isNonInteractiveGitAuthFailure(stderr: string): boolean {
        const normalized = stderr.toLowerCase();
        return (
            normalized.includes("terminal prompts disabled") ||
            normalized.includes("could not read username") ||
            normalized.includes("authentication failed") ||
            normalized.includes("could not resolve host")
        );
    }

    /**
     * Detects detached HEAD state where no upstream branch can be resolved.
     */
    private isDetachedHeadWithoutUpstream(stderr: string): boolean {
        return stderr.toLowerCase().includes("head does not point to a branch");
    }

    /**
     * Shows a throttled warning so users understand why remote conflict checks are unavailable.
     */
    private warnDetachedHeadState(repositoryRootPath: string, filePath: string): void {
        const now = Date.now();
        const lastWarningAt = this.lastDetachedHeadWarningAtByRepositoryRoot.get(repositoryRootPath) ?? 0;
        if (now - lastWarningAt < 5 * 60 * 1000) {
            return;
        }

        this.lastDetachedHeadWarningAtByRepositoryRoot.set(repositoryRootPath, now);
        void vscode.window.showWarningMessage(
            "Work Share: Remote conflict checks are unavailable because the repository is in detached HEAD state (no tracking branch).",
        );
        this.logger?.warn("Remote conflict checks unavailable due to detached HEAD state.", {
            repositoryRootPath,
            filePath,
        });
    }

    /**
     * Gets the master conflict list entry for a file path.
     * Returns undefined if evaluation is incomplete, empty array if clean, or array of conflicting patches.
     */
    public getProjectFileConflicts(repositoryFilePath: string): SharedPatch[] | undefined {
        return this.projectFileConflicts.get(repositoryFilePath);
    }

    /**
     * Merges patch-based and remote committed conflict sources into a single deterministic list.
     */
    private mergeConflictSources(
        patchConflicts: SharedPatch[],
        existingConflicts?: SharedPatch[],
        remoteConflictPatch?: SharedPatch,
    ): SharedPatch[] {
        const remoteConflicts = (existingConflicts ?? []).filter((patch) => patch.committed);
        if (remoteConflictPatch) {
            remoteConflicts.push(remoteConflictPatch);
        }

        const allConflicts = [...patchConflicts, ...remoteConflicts];
        const dedupedConflicts = new Map<string, SharedPatch>();

        for (const patch of allConflicts) {
            const dedupeKey = `${patch.userName}:${patch.repositoryFilePath}:${patch.baseCommit}:${patch.committed ? "1" : "0"}`;
            if (!dedupedConflicts.has(dedupeKey)) {
                dedupedConflicts.set(dedupeKey, patch);
            }
        }

        return Array.from(dedupedConflicts.values());
    }

    /**
     * Replaces the current user's server-side patch set for a repository with active local patches.
     */
    private async synchronizeRepositoryPatches(filePath?: string, force = false): Promise<void> {
        const syncIntervalMs = 15000;
        const repositoryRemoteUrl =
            (filePath ? await this.gitContext.getRepositoryRemoteUrl(filePath) : undefined) ??
            (await this.getCurrentRepositoryRemoteUrl());

        if (!repositoryRemoteUrl) {
            return;
        }

        const userName = await this.identityService.resolveIdentifiedUserName(filePath);
        if (!userName) {
            return;
        }

        if (this.patchSyncInFlightByRepository.has(repositoryRemoteUrl)) {
            return;
        }

        const now = Date.now();
        const lastSyncAt = this.lastPatchSyncAtByRepositoryRemoteUrl.get(repositoryRemoteUrl) ?? 0;
        if (!force && now - lastSyncAt < syncIntervalMs) {
            return;
        }

        this.patchSyncInFlightByRepository.add(repositoryRemoteUrl);
        try {
            const activePatches = await this.patchSharingService.buildActivePatchesForRepository(
                repositoryRemoteUrl,
                userName,
            );

            await this.apiClient.syncRepositoryUserPatches({
                repositoryRemoteUrl,
                userName,
                patches: activePatches,
            });

            this.lastPatchSyncAtByRepositoryRemoteUrl.set(repositoryRemoteUrl, now);
            this.logger?.info("Patch sync completed for repository.", {
                repositoryRemoteUrl,
                userName,
                synchronizedPatchCount: activePatches.length,
            });
        } catch (error) {
            this.logger?.warn("Patch sync failed for repository.", {
                repositoryRemoteUrl,
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.patchSyncInFlightByRepository.delete(repositoryRemoteUrl);
        }
    }

    /**
     * Opens a conflict in VS Code's merge editor so users can resolve it with built-in merge tooling.
     */
    public async openConflictInMergeEditor(conflictPatch: SharedPatch, repositoryRemoteUrl?: string): Promise<void> {
        await this.gitContext.initialize();
        await this.pruneStaleMergeViewTempDirectories();

        const repository =
            (conflictPatch.repositoryRemoteUrl ?
                await this.gitContext.resolveRepositoryByRemoteUrl(conflictPatch.repositoryRemoteUrl)
            :   undefined) ??
            (repositoryRemoteUrl ? await this.gitContext.resolveRepositoryByRemoteUrl(repositoryRemoteUrl) : undefined);

        if (!repository) {
            vscode.window.showWarningMessage("Work Share: Could not resolve repository for selected conflict.");
            return;
        }

        const repositoryRootPath = repository.rootUri.fsPath;
        const localFilePath = path.join(repositoryRootPath, conflictPatch.repositoryFilePath);

        const baseContent = await this.resolveBaseContent(
            repositoryRootPath,
            localFilePath,
            conflictPatch.baseCommit,
            conflictPatch.repositoryFilePath,
        );

        const incomingContent =
            conflictPatch.committed ?
                await this.readGitFileContent(
                    repositoryRootPath,
                    conflictPatch.userName,
                    conflictPatch.repositoryFilePath,
                )
            :   await this.materializeIncomingPatchContent(conflictPatch, baseContent);

        if (!incomingContent) {
            const incomingPatchUri = vscode.Uri.parse(
                `untitled:WorkShare-${path.basename(conflictPatch.repositoryFilePath)}.patch`,
            );
            const document = await vscode.workspace.openTextDocument(
                incomingPatchUri.with({
                    scheme: "untitled",
                }),
            );
            const editor = await vscode.window.showTextDocument(document, { preview: false });
            await editor.edit((editBuilder) => {
                editBuilder.insert(new vscode.Position(0, 0), conflictPatch.patch);
            });

            await vscode.commands.executeCommand(
                "vscode.diff",
                vscode.Uri.file(localFilePath),
                incomingPatchUri,
                `Work Share Conflict: ${conflictPatch.repositoryFilePath}`,
            );
            return;
        }

        const mergeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "work-share-merge-view-"));
        this.mergeViewTempDirectories.add(mergeDirectory);
        const baseFilePath = path.join(mergeDirectory, "base");
        const incomingFilePath = path.join(mergeDirectory, "incoming");
        await fs.writeFile(baseFilePath, baseContent, "utf8");
        await fs.writeFile(incomingFilePath, incomingContent, "utf8");

        const input2Title = conflictPatch.committed ? "Remote (Committed)" : "Incoming Patch";

        await vscode.commands.executeCommand("_open.mergeEditor", {
            base: vscode.Uri.file(baseFilePath),
            input1: {
                uri: vscode.Uri.file(localFilePath),
                title: "Current",
            },
            input2: {
                uri: vscode.Uri.file(incomingFilePath),
                title: input2Title,
            },
            output: vscode.Uri.file(localFilePath),
        });
    }

    /**
     * Prunes stale merge-view temp directories to avoid unbounded temp resource growth.
     */
    private async pruneStaleMergeViewTempDirectories(): Promise<void> {
        const tempRoot = os.tmpdir();
        const directoryPrefix = "work-share-merge-view-";
        const maxAgeMs = 2 * 60 * 60 * 1000;
        const now = Date.now();

        let entries: string[] = [];
        try {
            entries = await fs.readdir(tempRoot);
        } catch {
            return;
        }

        const candidateDirectories = entries
            .filter((entry) => entry.startsWith(directoryPrefix))
            .map((entry) => path.join(tempRoot, entry));

        for (const directoryPath of candidateDirectories) {
            try {
                const stat = await fs.stat(directoryPath);
                if (!stat.isDirectory()) {
                    continue;
                }

                if (now - stat.mtimeMs <= maxAgeMs) {
                    continue;
                }

                await fs.rm(directoryPath, { recursive: true, force: true });
                this.mergeViewTempDirectories.delete(directoryPath);
            } catch {
                // Ignore prune failures for files that are in use or already removed.
            }
        }
    }

    /**
     * Disposes merge-view temp directories tracked for this extension session.
     */
    private disposeMergeViewTempDirectories(): void {
        const directoriesToDispose = Array.from(this.mergeViewTempDirectories.values());
        this.mergeViewTempDirectories.clear();

        void Promise.allSettled(
            directoriesToDispose.map(async (directoryPath) => {
                try {
                    await fs.rm(directoryPath, { recursive: true, force: true });
                } catch {
                    // Ignore cleanup failures during shutdown.
                }
            }),
        );
    }

    /**
     * Reads file contents for a specific revision and repository-relative path.
     */
    private async readGitFileContent(
        repositoryRootPath: string,
        revision: string,
        repositoryFilePath: string,
    ): Promise<string | undefined> {
        const result = await this.gitContext.runGitCommand(repositoryRootPath, [
            "show",
            `${revision}:${repositoryFilePath}`,
        ]);

        if (result.exitCode !== 0) {
            return undefined;
        }

        return result.stdout;
    }

    /**
     * Materializes incoming file content from a unified diff patch using the provided base content.
     */
    private async materializeIncomingPatchContent(
        conflictPatch: SharedPatch,
        baseContent: string,
    ): Promise<string | undefined> {
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "work-share-patch-materialize-"));
        const targetFilePath = path.join(tempDirectory, conflictPatch.repositoryFilePath);
        const patchFilePath = path.join(tempDirectory, "incoming.patch");

        try {
            await fs.mkdir(path.dirname(targetFilePath), { recursive: true });
            await fs.writeFile(targetFilePath, baseContent, "utf8");
            await fs.writeFile(patchFilePath, conflictPatch.patch, "utf8");

            const applyStrategies: string[][] = [
                ["apply", patchFilePath],
                ["apply", "-p1", patchFilePath],
                ["apply", "-p0", patchFilePath],
                ["apply", "--recount", "--whitespace=nowarn", "-p1", patchFilePath],
                ["apply", "--recount", "--whitespace=nowarn", "-p0", patchFilePath],
            ];

            let applied = false;
            let lastStderr = "";

            for (const args of applyStrategies) {
                await fs.writeFile(targetFilePath, baseContent, "utf8");
                const applyResult = await this.gitContext.runGitCommand(tempDirectory, args);
                if (applyResult.exitCode === 0) {
                    applied = true;
                    break;
                }
                lastStderr = applyResult.stderr;
            }

            if (!applied) {
                const normalizedPatch = this.normalizePatchForSingleFile(conflictPatch);
                await fs.writeFile(patchFilePath, normalizedPatch, "utf8");
                await fs.writeFile(targetFilePath, baseContent, "utf8");

                const normalizedApplyResult = await this.gitContext.runGitCommand(tempDirectory, [
                    "apply",
                    "-p0",
                    patchFilePath,
                ]);

                if (normalizedApplyResult.exitCode !== 0) {
                    this.logger?.warn("Failed to materialize incoming patch content.", {
                        repositoryFilePath: conflictPatch.repositoryFilePath,
                        stderr: normalizedApplyResult.stderr || lastStderr,
                    });
                    return undefined;
                }
            }

            return await fs.readFile(targetFilePath, "utf8");
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    }

    /**
     * Resolves merge base content with fallbacks so incoming patch materialization has a stable base.
     */
    private async resolveBaseContent(
        repositoryRootPath: string,
        localFilePath: string,
        baseCommit: string,
        repositoryFilePath: string,
    ): Promise<string> {
        const baseFromCommit = await this.readGitFileContent(repositoryRootPath, baseCommit, repositoryFilePath);
        if (baseFromCommit !== undefined) {
            return baseFromCommit;
        }

        const baseFromHead = await this.readGitFileContent(repositoryRootPath, "HEAD", repositoryFilePath);
        if (baseFromHead !== undefined) {
            return baseFromHead;
        }

        try {
            return await fs.readFile(localFilePath, "utf8");
        } catch {
            return "";
        }
    }

    /**
     * Normalizes a unified diff so it targets only the expected repository-relative file path.
     */
    private normalizePatchForSingleFile(conflictPatch: SharedPatch): string {
        const targetPath = conflictPatch.repositoryFilePath;
        const lines = conflictPatch.patch.split(/\r?\n/);

        const normalized = lines.map((line) => {
            if (line.startsWith("diff --git ")) {
                return `diff --git ${targetPath} ${targetPath}`;
            }

            if (line.startsWith("--- ")) {
                return line.startsWith("--- /dev/null") ? line : `--- ${targetPath}`;
            }

            if (line.startsWith("+++ ")) {
                return line.startsWith("+++ /dev/null") ? line : `+++ ${targetPath}`;
            }

            return line;
        });

        return normalized.join("\n");
    }

    /**
     * Derives conflict status from the master list.
     * - undefined entry or unknown repo = 'unknown'
     * - empty array = 'clean'
     * - array with entries = 'conflict'
     */
    public getConflictStatusFromMasterList(
        repositoryRemoteUrl: string | undefined,
        repositoryFilePath: string,
    ): ConflictStatus {
        if (!repositoryRemoteUrl) {
            return "unknown";
        }

        const conflicts = this.projectFileConflicts.get(repositoryFilePath);
        if (conflicts === undefined) {
            return "unknown";
        }

        return conflicts.length > 0 ? "conflict" : "clean";
    }

    /**
     * Returns remote conflict availability issue for the current editor context, if present.
     */
    public async getCurrentRemoteConflictAvailabilityIssue(): Promise<string | undefined> {
        const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!activeFilePath) {
            return undefined;
        }

        await this.gitContext.initialize();
        const repository = this.gitContext.resolveRepositoryForFile(activeFilePath);
        if (!repository) {
            return undefined;
        }

        return this.remoteConflictAvailabilityIssueByRepositoryRoot.get(repository.rootUri.fsPath);
    }

    /**
     * Fetches the tracking remote for a repository, with interval-based throttling for background checks.
     */
    private async refreshTrackingBranchState(
        repositoryRootPath: string,
        upstreamRef: string,
        forceRefresh: boolean,
    ): Promise<boolean> {
        const remoteConflictInterval = this.getRemoteConflictCheckInterval();
        const remoteName = upstreamRef.split("/")[0];
        if (!remoteName) {
            return false;
        }

        const now = Date.now();
        const lastFetchAt = this.lastRemoteFetchAtByRepositoryRoot.get(repositoryRootPath) ?? 0;
        if (!forceRefresh && remoteConflictInterval > 0 && now - lastFetchAt < remoteConflictInterval) {
            return true;
        }

        const fetchResult = await this.gitContext.runGitCommand(repositoryRootPath, ["fetch", remoteName]);
        if (fetchResult.exitCode !== 0) {
            if (this.isNonInteractiveGitAuthFailure(fetchResult.stderr)) {
                const fallbackResult = await this.gitContext.fetchRemoteViaGitApi(repositoryRootPath, remoteName);
                if (fallbackResult.exitCode === 0) {
                    this.lastRemoteFetchAtByRepositoryRoot.set(repositoryRootPath, now);
                    this.logger?.info("Remote conflict check: fetched tracking branch via VS Code Git API.", {
                        repositoryRootPath,
                        remoteName,
                    });
                    return true;
                }

                this.logger?.warn("Remote conflict check: Git API fetch fallback failed.", {
                    repositoryRootPath,
                    remoteName,
                    stderr: fallbackResult.stderr,
                });
            }

            this.lastRemoteFetchAtByRepositoryRoot.set(repositoryRootPath, now);

            const logLevel = this.isNonInteractiveGitAuthFailure(fetchResult.stderr) ? "info" : "warn";
            this.logger?.[logLevel]("Remote conflict check skipped: unable to fetch tracking branch.", {
                repositoryRootPath,
                remoteName,
                exitCode: fetchResult.exitCode,
                stderr: fetchResult.stderr,
            });
            return false;
        }

        this.lastRemoteFetchAtByRepositoryRoot.set(repositoryRootPath, now);
        return true;
    }

    /**
     * Evaluates whether remote tracking branch changes may conflict with the local current file state.
     * Returns a SharedPatch object representing the remote conflict if detected, or undefined if clean/unknown.
     */
    private async evaluateRemoteTrackingConflictStatusForFile(
        filePath: string,
        repositoryFilePath: string,
        options?: { forceRefresh?: boolean },
    ): Promise<SharedPatch | undefined> {
        await this.gitContext.initialize();
        const repository = this.gitContext.resolveRepositoryForFile(filePath);
        if (!repository) {
            this.logger?.info("Remote conflict check skipped: repository not found for active file.", {
                filePath,
            });
            return undefined;
        }

        const upstreamRefResult = await this.gitContext.runGitCommand(repository.rootUri.fsPath, [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{u}",
        ]);
        if (upstreamRefResult.exitCode !== 0) {
            this.logger?.info("Remote conflict check skipped: repository has no upstream tracking branch.", {
                filePath,
                stderr: upstreamRefResult.stderr,
            });

            if (this.isDetachedHeadWithoutUpstream(upstreamRefResult.stderr)) {
                this.remoteConflictAvailabilityIssueByRepositoryRoot.set(
                    repository.rootUri.fsPath,
                    "Remote conflict checks unavailable: repository is in detached HEAD state (no tracking branch).",
                );
                this.warnDetachedHeadState(repository.rootUri.fsPath, filePath);
            }

            return undefined;
        }

        this.remoteConflictAvailabilityIssueByRepositoryRoot.delete(repository.rootUri.fsPath);

        const upstreamRef = upstreamRefResult.stdout.trim();
        if (!upstreamRef) {
            return undefined;
        }

        const fetched = await this.refreshTrackingBranchState(
            repository.rootUri.fsPath,
            upstreamRef,
            options?.forceRefresh ?? false,
        );
        if (!fetched) {
            return undefined;
        }

        const mergeBaseResult = await this.gitContext.runGitCommand(repository.rootUri.fsPath, [
            "merge-base",
            "HEAD",
            upstreamRef,
        ]);
        if (mergeBaseResult.exitCode !== 0) {
            this.logger?.warn("Remote conflict check: failed to resolve merge base.", {
                filePath,
                upstreamRef,
                stderr: mergeBaseResult.stderr,
            });
            return undefined;
        }

        const mergeBase = mergeBaseResult.stdout.trim();
        if (!mergeBase) {
            return undefined;
        }

        const diffResult = await this.gitContext.runGitCommand(repository.rootUri.fsPath, [
            "diff",
            "--binary",
            "--full-index",
            `${mergeBase}..${upstreamRef}`,
            "--",
            repositoryFilePath,
        ]);
        if (diffResult.exitCode !== 0) {
            this.logger?.warn("Remote conflict check: failed to diff tracking branch.", {
                filePath,
                repositoryFilePath,
                upstreamRef,
                stderr: diffResult.stderr,
            });
            return undefined;
        }

        if (!diffResult.stdout.trim()) {
            return undefined;
        }

        // Use git merge-file to detect conflicts without touching the working tree
        // This works even with uncommitted local changes
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "work-share-merge-"));
        try {
            // Extract the three versions needed for 3-way merge
            const baseFile = path.join(tempDirectory, "base");
            const headFile = path.join(tempDirectory, "head");
            const upstreamFile = path.join(tempDirectory, "upstream");

            // Get file content from merge-base
            const baseContent = await this.gitContext.runGitCommand(repository.rootUri.fsPath, [
                "show",
                `${mergeBase}:${repositoryFilePath}`,
            ]);
            if (baseContent.exitCode !== 0) {
                // File might not exist at merge-base, treat as no conflict possible
                return undefined;
            }
            await fs.writeFile(baseFile, baseContent.stdout, "utf8");

            // Get file content from working tree (current state with uncommitted changes)
            try {
                const workingTreeContent = await fs.readFile(filePath, "utf8");
                await fs.writeFile(headFile, workingTreeContent, "utf8");
            } catch (error) {
                // File doesn't exist in working tree
                return undefined;
            }

            // Get file content from upstream
            const upstreamContent = await this.gitContext.runGitCommand(repository.rootUri.fsPath, [
                "show",
                `${upstreamRef}:${repositoryFilePath}`,
            ]);
            if (upstreamContent.exitCode !== 0) {
                // File doesn't exist in upstream anymore
                return undefined;
            }
            await fs.writeFile(upstreamFile, upstreamContent.stdout, "utf8");

            // Run git merge-file to detect conflicts
            // Exit code: 0 = no conflicts, 1 = conflicts detected
            const mergeFileResult = await this.gitContext.runGitCommand(repository.rootUri.fsPath, [
                "merge-file",
                "-p",
                headFile,
                baseFile,
                upstreamFile,
            ]);

            const hasConflicts = mergeFileResult.exitCode > 0;

            this.logger?.info("Remote conflict check completed for active file.", {
                filePath,
                repositoryFilePath,
                upstreamRef,
                conflictDetected: hasConflicts,
                mergeFileExitCode: mergeFileResult.exitCode,
            });

            if (hasConflicts) {
                // Create SharedPatch entry for remote conflict with committed flag
                const repositoryRemoteUrl = await this.gitContext.getRepositoryRemoteUrl(filePath);

                return {
                    repositoryRemoteUrl: repositoryRemoteUrl ?? "",
                    userName: upstreamRef,
                    repositoryFilePath,
                    baseCommit: mergeBase,
                    patch: diffResult.stdout,
                    timestamp: new Date(),
                    committed: true,
                };
            }

            return undefined;
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    }

    /**
     * Periodically refreshes remote conflict status for the active editor file and surfaces new conflicts.
     */
    private async refreshActiveFileRemoteConflicts(forceRefresh: boolean): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }

        const filePath = activeEditor.document.uri.fsPath;
        if (!vscode.workspace.getWorkspaceFolder(activeEditor.document.uri) || isGitInternalPath(filePath)) {
            return;
        }

        try {
            const repositoryRemoteUrl = await this.gitContext.getRepositoryRemoteUrl(filePath);
            const repositoryFilePath = this.gitContext.getRepositoryRelativeFilePath(filePath);
            if (!repositoryFilePath) {
                return;
            }

            const previousConflicts = this.projectFileConflicts.get(repositoryFilePath);
            const previousStatus =
                previousConflicts === undefined ? "unknown"
                : previousConflicts.length > 0 ? "conflict"
                : "clean";

            const remoteConflictPatch = await this.evaluateRemoteTrackingConflictStatusForFile(
                filePath,
                repositoryFilePath,
                { forceRefresh },
            );

            // Update master list: keep patch conflicts and refresh only remote committed conflicts.
            const patchConflicts = (previousConflicts ?? []).filter((patch) => !patch.committed);
            const currentConflicts = this.mergeConflictSources(patchConflicts, undefined, remoteConflictPatch);
            this.projectFileConflicts.set(repositoryFilePath, currentConflicts);

            const currentStatus = currentConflicts.length > 0 ? "conflict" : "clean";

            this.logger?.info("Background remote conflict status refreshed.", {
                filePath,
                repositoryFilePath,
                repositoryRemoteUrl,
                hasRemoteConflict: !!remoteConflictPatch,
                totalConflicts: currentConflicts.length,
                forceRefresh,
            });

            if (currentStatus === "conflict" && previousStatus !== "conflict") {
                this._onDidChangeConflictStatus.fire();
                void vscode.window.showWarningMessage(
                    "Work Share: Remote tracking branch has changes that may conflict with the active file.",
                );
            } else if (currentStatus !== previousStatus) {
                this._onDidChangeConflictStatus.fire();
            }
        } catch (error) {
            this.logger?.error("Error refreshing remote conflict status for active file.", {
                filePath,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Checks whether an incoming patch conflicts with the current local working tree.
     */
    private async doesIncomingPatchConflict(repositoryRootPath: string, patch: SharedPatch): Promise<boolean> {
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "work-share-patch-"));
        const patchFilePath = path.join(tempDirectory, "incoming.patch");

        this.logger?.info("Conflict detector: checking incoming patch.", {
            repositoryFilePath: patch.repositoryFilePath,
            fromUser: patch.userName,
            baseCommit: patch.baseCommit,
        });

        try {
            await fs.writeFile(patchFilePath, patch.patch, "utf8");

            // Run a dry-run 3-way apply against the receiver's current working tree.
            // This reports conflicts with local edits without mutating files.
            const applyCheckResult = await this.gitContext.runGitCommand(repositoryRootPath, [
                "apply",
                "--3way",
                "--check",
                patchFilePath,
            ]);

            this.logger?.info("Conflict detector: patch check completed.", {
                repositoryFilePath: patch.repositoryFilePath,
                fromUser: patch.userName,
                conflictDetected: applyCheckResult.exitCode !== 0,
                stderr: applyCheckResult.stderr,
            });

            return applyCheckResult.exitCode !== 0;
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    }

    /**
     * Evaluates conflict status for repository-relative files based on incoming patches.
     * @returns Map of repository-relative file paths to conflict status ("clean", "conflict", or "unknown").
     */
    /**
     * Evaluates conflicts for a single file against pending patches.
     * Returns the array of conflicting patches for the master list.
     */
    private async evaluatePatchConflictsForFile(
        repositoryRemoteUrl: string | undefined,
        repositoryFilePath: string,
    ): Promise<SharedPatch[]> {
        if (!repositoryRemoteUrl) {
            return [];
        }

        await this.identityService.getCurrentUserName();

        const repository = await this.gitContext.resolveRepositoryByRemoteUrl(repositoryRemoteUrl);
        if (!repository) {
            return [];
        }

        const incomingPatches = await this.apiClient.getPatches({ repositoryRemoteUrl });
        const currentUserName = await this.identityService.getCurrentUserName();
        const relevantPatches = incomingPatches.filter(
            (patch) => patch.userName !== currentUserName && patch.repositoryFilePath === repositoryFilePath,
        );

        this.logger?.info("Conflict detector: evaluating patches for file.", {
            repositoryRemoteUrl,
            repositoryFilePath,
            currentUserName,
            totalIncomingPatches: incomingPatches.length,
            relevantIncomingPatches: relevantPatches.length,
        });

        const conflictingPatches: SharedPatch[] = [];
        const sortedPatches = relevantPatches.sort(
            (left, right) => right.timestamp.getTime() - left.timestamp.getTime(),
        );

        for (const patch of sortedPatches.slice(0, 5)) {
            const conflicts = await this.doesIncomingPatchConflict(repository.rootUri.fsPath, patch);
            if (conflicts) {
                conflictingPatches.push(patch);
            }
        }

        this.logger?.info("Conflict detector: file status computed.", {
            repositoryFilePath,
            evaluatedPatches: Math.min(sortedPatches.length, 5),
            conflictingPatches: conflictingPatches.length,
        });

        return conflictingPatches;
    }

    /**
     * Evaluates conflicts for multiple files against pending patches.
     * Returns statuses for backward compatibility. Full conflict source tracking uses master list.
     */
    public async evaluateFileConflictAgainstPendingPatches(
        repositoryRemoteUrl: string | undefined,
        repositoryRelativeFilePaths: string[],
    ): Promise<Map<string, ConflictStatus>> {
        const statuses = new Map<string, ConflictStatus>();

        for (const filePath of repositoryRelativeFilePaths) {
            const patchConflicts = await this.evaluatePatchConflictsForFile(repositoryRemoteUrl, filePath);
            const existingConflicts = this.projectFileConflicts.get(filePath);
            const mergedConflicts = this.mergeConflictSources(patchConflicts, existingConflicts);

            this.projectFileConflicts.set(filePath, mergedConflicts);
            statuses.set(filePath, mergedConflicts.length > 0 ? "conflict" : "clean");
        }

        return statuses;
    }

    /**
     * Checks combined conflict status for a repository-relative file path.
     * Reads from the master projectFileConflicts list which contains both patch and remote conflicts.
     */
    public async getCombinedConflictStatusForRepositoryFile(
        repositoryRemoteUrl: string | undefined,
        repositoryFilePath: string,
    ): Promise<ConflictStatus> {
        if (!repositoryRemoteUrl) {
            return "unknown";
        }

        return this.getConflictStatusFromMasterList(repositoryRemoteUrl, repositoryFilePath);
    }

    /**
     * Evaluates a file for conflicts and updates the master projectFileConflicts list.
     * Performs the actual work of evaluating a file for conflicts:
     *  1: Local file is evaluated against pending patches from the server (populates master list with conflicting patches)
     *  2: Local file is evaluated against changes committed to remote repository (adds remote conflicts to master list)
     */
    public async updateConflictStatusForFile(filePath: string): Promise<ConflictStatus> {
        const repositoryRemoteUrl = await this.gitContext.getRepositoryRemoteUrl(filePath);
        const repositoryFilePath = this.gitContext.getRepositoryRelativeFilePath(filePath);
        if (!repositoryFilePath) {
            return "unknown";
        }

        // Evaluate and store patch-based conflicts in master list
        const patchConflicts = await this.evaluatePatchConflictsForFile(repositoryRemoteUrl, repositoryFilePath);

        // Evaluate and add remote conflicts to master list
        const remoteConflictPatch = await this.evaluateRemoteTrackingConflictStatusForFile(
            filePath,
            repositoryFilePath,
            { forceRefresh: true },
        );

        const existingConflicts = this.projectFileConflicts.get(repositoryFilePath);
        const allConflicts = this.mergeConflictSources(patchConflicts, existingConflicts, remoteConflictPatch);

        // Update master list
        this.projectFileConflicts.set(repositoryFilePath, allConflicts);
        this._onDidChangeConflictStatus.fire();

        return allConflicts.length > 0 ? "conflict" : "clean";
    }

    /**
     * Checks conflict status across files referenced by incoming shared patches for the current repository.
     */
    public async checkProjectConflictStatuses(): Promise<{
        status: ConflictStatus;
        checkedFileCount: number;
        conflictFilePaths: string[];
    }> {
        const repositoryRemoteUrl = await this.getCurrentRepositoryRemoteUrl();
        if (!repositoryRemoteUrl) {
            this.logger?.warn("Project conflict check skipped: no active repository remote URL.");
            return {
                status: "unknown",
                checkedFileCount: 0,
                conflictFilePaths: [],
            };
        }

        const currentUserName = await this.identityService.getCurrentUserName();
        const incomingPatches = await this.apiClient.getPatches({ repositoryRemoteUrl });
        const repositoryRelativeFilePaths = Array.from(
            new Set(
                incomingPatches
                    .filter((patch) => patch.userName !== currentUserName)
                    .map((patch) => patch.repositoryFilePath),
            ),
        );

        if (repositoryRelativeFilePaths.length === 0) {
            this.logger?.info("Project conflict check completed: no incoming files to evaluate.", {
                repositoryRemoteUrl,
            });
            return {
                status: "clean",
                checkedFileCount: 0,
                conflictFilePaths: [],
            };
        }

        const statuses = await this.evaluateFileConflictAgainstPendingPatches(
            repositoryRemoteUrl,
            repositoryRelativeFilePaths,
        );
        const conflictFilePaths = repositoryRelativeFilePaths.filter(
            (filePath) => statuses.get(filePath) === "conflict",
        );

        const status: ConflictStatus = conflictFilePaths.length > 0 ? "conflict" : "clean";
        this.logger?.info("Project conflict check completed.", {
            repositoryRemoteUrl,
            checkedFileCount: repositoryRelativeFilePaths.length,
            conflictCount: conflictFilePaths.length,
            conflictFilePaths,
        });

        return {
            status,
            checkedFileCount: repositoryRelativeFilePaths.length,
            conflictFilePaths,
        };
    }

    /**
     * Starts event subscriptions and background send timer.
     */
    public start() {
        const config = vscode.workspace.getConfiguration("workShare");
        const enabled = config.get<boolean>("enabled", true);
        const interval = config.get<number>("updateInterval", 5000);

        this.logger?.info("File activity tracker starting.", {
            enabled,
            updateInterval: interval,
        });

        if (!enabled) {
            this.logger?.warn("File activity tracker is disabled by configuration.");
            return;
        }

        // Track file open events
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    void this.trackActivity(editor.document.uri.fsPath, "open");
                    void this.refreshActiveFileRemoteConflicts(true);
                }
            }),
        );

        // Track file edit events
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.contentChanges.length > 0) {
                    void this.trackActivity(event.document.uri.fsPath, "edit");
                }
            }),
        );

        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument((document) => {
                void this.patchSharingService.sharePatchForFile(document.uri.fsPath);
                void this.synchronizeRepositoryPatches(document.uri.fsPath, true);
                void this.autoCheckConflictsOnSave(document.uri.fsPath);
            }),
        );

        // Track file close events
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                void this.trackActivity(doc.uri.fsPath, "close");
            }),
        );

        // Start periodic update timer
        this.startUpdateTimer();
        this.startRemoteConflictTimer();
        void this.synchronizeRepositoryPatches(undefined, true);
        void this.refreshActiveFileRemoteConflicts(true);
    }

    /**
     * Stops event subscriptions and pending timers.
     */
    public stop() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];

        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = undefined;
        }

        if (this.remoteConflictTimer) {
            clearInterval(this.remoteConflictTimer);
            this.remoteConflictTimer = undefined;
        }

        this.disposeMergeViewTempDirectories();
        this.activities.clear();
        this.projectFileConflicts.clear();
        this.patchSyncInFlightByRepository.clear();
        this.lastPatchSyncAtByRepositoryRemoteUrl.clear();
        this.lastRemoteFetchAtByRepositoryRoot.clear();
        this.lastDetachedHeadWarningAtByRepositoryRoot.clear();
        this.remoteConflictAvailabilityIssueByRepositoryRoot.clear();
    }

    private startUpdateTimer() {
        const config = vscode.workspace.getConfiguration("workShare");
        const interval = config.get<number>("updateInterval", 5000);

        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        this.updateTimer = setInterval(() => {
            void this.sendActivitiesToServer();
            void this.synchronizeRepositoryPatches(undefined, false);
        }, interval);
    }

    /**
     * Starts the background timer that refreshes the active file against the remote tracking branch.
     */
    private startRemoteConflictTimer() {
        const interval = this.getRemoteConflictCheckInterval();
        if (interval <= 0) {
            this.logger?.info("Remote conflict tracking timer disabled by configuration.", { interval });
            return;
        }

        if (this.remoteConflictTimer) {
            clearInterval(this.remoteConflictTimer);
        }

        this.remoteConflictTimer = setInterval(() => {
            void this.refreshActiveFileRemoteConflicts(false);
        }, interval);
    }

    private async trackActivity(filePath: string, action: "open" | "edit" | "close") {
        // Ignore non-workspace files
        if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))) {
            return;
        }

        // Ignore files inside .git directory and git internal files
        if (isGitInternalPath(filePath)) {
            return;
        }

        // Ignore files that are in .gitignore
        if (await this.gitContext.isFileIgnoredByGit(filePath)) {
            return;
        }

        const repositoryRemoteUrl = await this.gitContext.getRepositoryRemoteUrl(filePath);
        if (!repositoryRemoteUrl) {
            return;
        }

        const userName = await this.identityService.resolveIdentifiedUserName(filePath);
        if (!userName) {
            this.identityService.logIdentityBlockedActivity(filePath, action);
            return;
        }

        const activity: FileActivity = {
            filePath,
            userName,
            timestamp: new Date(),
            action,
            repositoryRemoteUrl,
        };

        this.activities.set(filePath, activity);
        this.logger?.info("Activity enqueued.", {
            filePath,
            action,
            userName,
            queueSize: this.activities.size,
        });
    }

    private async sendActivitiesToServer() {
        if (this.activities.size === 0) {
            return;
        }

        const activitiesToSend = Array.from(this.activities.values());
        this.logger?.info("Attempting to flush queued activities.", {
            count: activitiesToSend.length,
        });

        try {
            await this.apiClient.sendActivities(activitiesToSend);
            // Clear sent activities if close action
            for (const [pathKey, activity] of this.activities) {
                if (activity.action === "close") {
                    this.activities.delete(pathKey);
                }
            }
            this.logger?.info("Activity flush completed.", {
                sentCount: activitiesToSend.length,
                remainingQueueSize: this.activities.size,
            });
        } catch (error) {
            this.logger?.error("Activity flush failed.", {
                message: error instanceof Error ? error.message : String(error),
                attemptedCount: activitiesToSend.length,
            });
            console.error("Failed to send activities to server:", error);
        }
    }

    /**
     * Returns locally tracked activities scoped to the currently active repository.
     */
    public async getActivities(): Promise<FileActivity[]> {
        const currentRepositoryRemoteUrl = await this.getCurrentRepositoryRemoteUrl();
        const allActivities = Array.from(this.activities.values());

        if (!currentRepositoryRemoteUrl) {
            return allActivities;
        }

        return allActivities.filter((activity) => activity.repositoryRemoteUrl === currentRepositoryRemoteUrl);
    }

    /**
     * Restarts tracker state to apply latest configuration values.
     */
    public updateConfiguration() {
        this.identityService.resetWarnings();
        this.stop();
        this.start();
    }
}
