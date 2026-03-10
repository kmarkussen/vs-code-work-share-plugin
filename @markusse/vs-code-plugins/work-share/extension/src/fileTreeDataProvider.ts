import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { OutputLogger } from "./outputLogger";
import { FileActivityTracker } from "./fileActivityTracker";
import { SharedPatch } from "./sharedPatch";
import { GitContextService } from "./fileActivity/gitContext";

type TreeItemKind =
    | "status-group"
    | "repository"
    | "file"
    | "user"
    | "patch"
    | "placeholder"
    | "status"
    | "context"
    | "sharing-status";

export class WorkStatusDataProvider implements vscode.TreeDataProvider<FileTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileTreeItem | undefined | void> = new vscode.EventEmitter<
        FileTreeItem | undefined | void
    >();
    readonly onDidChangeTreeData: vscode.Event<FileTreeItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(
        private apiClient: ApiClient,
        private tracker?: FileActivityTracker,
        private logger?: OutputLogger,
    ) {
        // Listen to data change events from API client
        apiClient.onDidChangeData(() => {
            this.refresh();
        });

        // Listen to conflict status changes from tracker
        if (tracker) {
            tracker.onDidChangeConflictStatus(() => {
                this.refresh();
            });
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FileTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    /**
     * Builds the status section rows shown at the top of the Work Share tree.
     */
    private async getStatusSectionItems(): Promise<FileTreeItem[]> {
        const connectionIssue = this.apiClient.getConnectionIssue();
        const trackerForStatus = this.tracker as Partial<FileActivityTracker> | undefined;

        const currentUserName =
            trackerForStatus && typeof trackerForStatus.getCurrentUserName === "function" ?
                await trackerForStatus.getCurrentUserName()
            :   "Unknown user";
        const isActivelySharing =
            trackerForStatus && typeof trackerForStatus.isActivelySharingActivity === "function" ?
                await trackerForStatus.isActivelySharingActivity()
            :   false;
        const remoteConflictIssue =
            trackerForStatus && typeof trackerForStatus.getCurrentRemoteConflictAvailabilityIssue === "function" ?
                await trackerForStatus.getCurrentRemoteConflictAvailabilityIssue()
            :   undefined;

        const sharingEnabled = vscode.workspace.getConfiguration("workShare").get<boolean>("enabled", true);

        const items: FileTreeItem[] = [
            FileTreeItem.sharingStatus(sharingEnabled),
            FileTreeItem.context(
                connectionIssue ? "Connection: Issue detected" : "Connection: Connected",
                connectionIssue ? "warning" : "plug",
                connectionIssue?.message ?? "Connected to Work Share API.",
            ),
            FileTreeItem.context(
                `Current User: ${currentUserName}`,
                "account",
                isActivelySharing ?
                    "User identity resolved and activity sharing is active."
                :   "User identity is not resolved. Configure workShare.userName or git user.name.",
            ),
        ];

        if (remoteConflictIssue) {
            items.push(FileTreeItem.status(remoteConflictIssue, "warning"));
        }

        return items;
    }

    /**
     * Builds status section rows including repository and upstream branch context.
     */
    private async getRepositoryStatusItems(): Promise<FileTreeItem[]> {
        const trackerForStatus = this.tracker as Partial<FileActivityTracker> | undefined;
        const items: FileTreeItem[] = [];

        const repositoryRemoteUrl =
            trackerForStatus && typeof trackerForStatus.getCurrentRepositoryRemoteUrl === "function" ?
                await trackerForStatus.getCurrentRepositoryRemoteUrl()
            :   undefined;

        if (repositoryRemoteUrl) {
            const repoName = repositoryRemoteUrl.split("/").slice(-1)[0].replace(/\.git$/, "") || repositoryRemoteUrl;
            items.push(
                FileTreeItem.context(`Repository: ${repoName}`, "repo", repositoryRemoteUrl),
            );
        }

        const upstreamBranch =
            trackerForStatus && typeof trackerForStatus.getUpstreamBranchForCurrentRepository === "function" ?
                await (trackerForStatus.getUpstreamBranchForCurrentRepository as () => Promise<string | undefined>)()
            :   undefined;

        if (upstreamBranch) {
            items.push(
                FileTreeItem.context(`Upstream: ${upstreamBranch}`, "git-branch", `Tracking branch: ${upstreamBranch}`),
            );
        } else if (repositoryRemoteUrl) {
            items.push(
                FileTreeItem.status("No upstream branch — run 'Select Upstream Branch'", "warning"),
            );
        }

        return items;
    }

    async getChildren(element?: FileTreeItem): Promise<FileTreeItem[]> {
        // Root: fetch repositories and files
        if (!element) {
            const rootItems: FileTreeItem[] = [];
            const statusItems = await this.getStatusSectionItems();
            const repoItems = await this.getRepositoryStatusItems();
            rootItems.push(FileTreeItem.statusGroup([...statusItems, ...repoItems]));

            return rootItems;
        }

        if (element?.kind === "status-group") {
            const statusItems = element.statusItems ?? [];
            statusItems.forEach((item) => {
                item.parent = element;
            });
            return statusItems;
        }

        return [];
    }
}

/**
 * Simplified tree view provider that shows repositories and files with active users and patches.
 */
export class FileTreeDataProvider implements vscode.TreeDataProvider<FileTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileTreeItem | undefined | void> = new vscode.EventEmitter<
        FileTreeItem | undefined | void
    >();
    readonly onDidChangeTreeData: vscode.Event<FileTreeItem | undefined | void> = this._onDidChangeTreeData.event;

    /**
     * Cache of file tree items for reveal operations.
     */
    private fileItemsByPath: Map<string, FileTreeItem> = new Map();

    private gitContext: GitContextService;

    constructor(
        private apiClient: ApiClient,
        private tracker?: FileActivityTracker,
        private logger?: OutputLogger,
    ) {
        this.gitContext = new GitContextService();
        this.gitContext.initialize();

        // Listen to data change events from API client
        apiClient.onDidChangeData(() => {
            this.refresh();
        });

        // Listen to conflict status changes from tracker
        if (tracker) {
            tracker.onDidChangeConflictStatus(() => {
                this.refresh();
            });
        }
    }

    /**
     * Refresh tree data.
     */
    refresh(): void {
        this.fileItemsByPath.clear();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Reveals and selects a file node by repository-relative path.
     */
    async revealFileByPath(
        treeView: vscode.TreeView<FileTreeItem | undefined>,
        repositoryFilePath: string,
        repositoryRemoteUrl: string | undefined,
    ): Promise<void> {
        const key = `${repositoryRemoteUrl}:${repositoryFilePath}`;
        const fileItem = this.fileItemsByPath.get(key);
        if (!fileItem) {
            return;
        }

        try {
            await treeView.reveal(fileItem, {
                select: true,
                focus: true,
                expand: true,
            });
        } catch {
            // Ignore transient reveal errors
        }
    }

    getTreeItem(element: FileTreeItem): vscode.TreeItem {
        return element;
    }

    getParent(element: FileTreeItem): vscode.ProviderResult<FileTreeItem | undefined> {
        return element.parent;
    }

    async getChildren(element?: FileTreeItem): Promise<FileTreeItem[]> {
        // Root: fetch repositories and files
        if (!element) {
            const rootItems: FileTreeItem[] = [];
            try {
                const gitRepositories = await this.gitContext.getRepositories();
                const repos = await this.apiClient.getFiles();

                if (repos.length === 0) {
                    rootItems.push(FileTreeItem.placeholder("No active files right now"));
                    return rootItems;
                }

                for (const repo of gitRepositories || []) {
                    const repoItem = FileTreeItem.repository(
                        repo.rootUri.fsPath.split("/").slice(-1)[0],
                        repo.rootUri.fsPath,
                        repo.state?.HEAD?.upstream?.name,
                        [],
                    );
                    repoItem.parent = undefined;
                    rootItems.push(repoItem);
                }

                // for (const repo of repos) {
                //     const repoItem = FileTreeItem.repository(
                //         repo.repositoryName,
                //         repo.repositoryRemoteUrl,
                //         repo.upstreamBranch,
                //         repo.files,
                //     );
                //     repoItem.parent = undefined;
                //     rootItems.push(repoItem);
                // }

                return rootItems;
            } catch (error) {
                this.logger?.error("Failed to fetch files", { error: String(error) });
                rootItems.push(
                    FileTreeItem.status("Failed to load file activity. Check Work Share API connection.", "error"),
                );
                return rootItems;
            }
        }

        // Repository: show files
        if (element.kind === "repository") {
            const files = element.files || [];
            if (files.length === 0) {
                const placeholder = FileTreeItem.placeholder("No active files in this repository");
                placeholder.parent = element;
                return [placeholder];
            }

            const cacheKey = `${element.repositoryRemoteUrl}`;
            this.fileItemsByPath.set(cacheKey, element);
            const fileItems = await Promise.all(
                files.map(async (file) => {
                    // Get actual conflict patches to distinguish types
                    const conflictPatches = this.tracker?.getProjectFileConflicts(file.repositoryFilePath);
                    const fileItem = FileTreeItem.file(
                        file.repositoryFileName,
                        file.activeUsers,
                        file.patches,
                        file,
                        conflictPatches,
                    );
                    fileItem.parent = element;
                    const cacheKey = `${file.repositoryRemoteUrl}:${file.repositoryFilePath}`;
                    this.fileItemsByPath.set(cacheKey, fileItem);
                    return fileItem;
                }),
            );

            return fileItems;
        }

        // File: show active users and patches
        if (element.kind === "file") {
            const children: FileTreeItem[] = [];

            // Active users
            if (element.activeUsers && element.activeUsers.length > 0) {
                const userItem = FileTreeItem.context(
                    `Editing: ${element.activeUsers.join(", ")}`,
                    "account",
                    `${element.activeUsers.length} user(s) currently editing`,
                );
                userItem.parent = element;
                children.push(userItem);
            }

            // Patches: render a merged list so remote conflicts never hide patch rows.
            const mergedPatchMap = new Map<string, SharedPatch>();

            for (const conflictPatch of element.conflictPatches ?? []) {
                const key = `${conflictPatch.userName}:${conflictPatch.repositoryFilePath}:${conflictPatch.baseCommit}:${conflictPatch.patch}:${conflictPatch.committed ? "1" : "0"}`;
                mergedPatchMap.set(key, conflictPatch);
            }

            for (const patch of element.patches ?? []) {
                const normalizedPatch: SharedPatch = {
                    repositoryRemoteUrl: patch.repositoryRemoteUrl,
                    userName: patch.userName,
                    repositoryFilePath: patch.repositoryFilePath,
                    baseCommit: patch.baseCommit,
                    patch: patch.patch,
                    timestamp: new Date(patch.timestamp),
                    committed: false,
                };

                const key = `${normalizedPatch.userName}:${normalizedPatch.repositoryFilePath}:${normalizedPatch.baseCommit}:${normalizedPatch.patch}:0`;
                if (!mergedPatchMap.has(key)) {
                    mergedPatchMap.set(key, normalizedPatch);
                }
            }

            for (const patch of mergedPatchMap.values()) {
                const patchItem = FileTreeItem.patch(patch, element.repositoryRemoteUrl, element.repositoryFilePath);
                patchItem.parent = element;
                children.push(patchItem);
            }

            return children.length > 0 ? children : [];
        }

        return [];
    }
}

/**
 * Tree item for file-centric view.
 */
class FileTreeItem extends vscode.TreeItem {
    public parent: FileTreeItem | undefined;

    constructor(
        public readonly kind: TreeItemKind,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly statusItems?: FileTreeItem[],

        public readonly files?: Array<{
            repositoryRemoteUrl: string;
            repositoryFilePath: string;
            repositoryFileName: string;
            activeUsers: string[];
            patches: Array<{
                repositoryRemoteUrl: string;
                userName: string;
                repositoryFilePath: string;
                baseCommit: string;
                patch: string;
                timestamp: string;
            }>;
            lastActivity: string;
        }>,
        public readonly activeUsers?: string[],
        public readonly patches?: Array<{
            repositoryRemoteUrl: string;
            userName: string;
            repositoryFilePath: string;
            baseCommit: string;
            patch: string;
            timestamp: string;
        }>,
        public readonly conflictPatches?: SharedPatch[],
        public readonly repositoryRemoteUrl?: string,
        public readonly repositoryFilePath?: string,
    ) {
        super(label, collapsibleState);
    }

    static statusGroup(statusItems: FileTreeItem[]): FileTreeItem {
        const item = new FileTreeItem(
            "status-group",
            "Work Share",
            vscode.TreeItemCollapsibleState.Expanded,
            statusItems,
        );
        item.iconPath = new vscode.ThemeIcon("info");
        item.tooltip = "Connection, identity, and remote conflict availability status.";
        return item;
    }

    static repository(
        name: string,
        remoteUrl: string | undefined,
        upstreamBranch: string | undefined,
        files: Array<{
            repositoryRemoteUrl: string;
            repositoryFilePath: string;
            repositoryFileName: string;
            activeUsers: string[];
            patches: Array<{
                repositoryRemoteUrl: string;
                userName: string;
                repositoryFilePath: string;
                baseCommit: string;
                patch: string;
                timestamp: string;
            }>;
            lastActivity: string;
        }>,
    ): FileTreeItem {
        const item = new FileTreeItem(
            "repository",
            `${name}:${upstreamBranch ?? "no upstream"}`,
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            files,
        );
        item.iconPath = new vscode.ThemeIcon("repo");
        item.tooltip = remoteUrl ?? "Repository";
        item.description = `${files.length} file(s) being edited`;
        return item;
    }

    static file(
        fileName: string,
        activeUsers: string[],
        patches: Array<{
            repositoryRemoteUrl: string;
            userName: string;
            repositoryFilePath: string;
            baseCommit: string;
            patch: string;
            timestamp: string;
        }>,
        fileData?: {
            repositoryRemoteUrl: string;
            repositoryFilePath: string;
            repositoryFileName: string;
            activeUsers: string[];
            patches: Array<{
                repositoryRemoteUrl: string;
                userName: string;
                repositoryFilePath: string;
                baseCommit: string;
                patch: string;
                timestamp: string;
            }>;
            lastActivity: string;
        },
        conflictPatches?: SharedPatch[],
    ): FileTreeItem {
        const item = new FileTreeItem(
            "file",
            fileName,
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            undefined,
            activeUsers,
            patches,
            conflictPatches,
            fileData?.repositoryRemoteUrl,
            fileData?.repositoryFilePath,
        );

        // Determine conflict type for icon and tooltip
        const hasRemoteConflict = conflictPatches?.some((p) => p.committed) ?? false;
        const hasPatchConflict = conflictPatches?.some((p) => !p.committed) ?? false;

        if (hasRemoteConflict && hasPatchConflict) {
            // Both types of conflicts
            item.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("list.errorForeground"));
            item.tooltip = `⚠ Conflicts detected:\n• Remote branch changes (committed)\n• Team member patches (uncommitted)\n${fileData?.repositoryFilePath ?? fileName}`;
        } else if (hasRemoteConflict) {
            // Remote tracking branch conflict only
            item.iconPath = new vscode.ThemeIcon("git-branch", new vscode.ThemeColor("list.warningForeground"));
            item.tooltip = `⚠ Remote branch conflict detected (committed changes)\n${fileData?.repositoryFilePath ?? fileName}`;
        } else if (hasPatchConflict) {
            // Patch conflict only
            item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.errorForeground"));
            item.tooltip = `⚠ Team member patch conflict detected\n${fileData?.repositoryFilePath ?? fileName}`;
        } else {
            // No conflicts
            item.iconPath = new vscode.ThemeIcon("file");
            item.tooltip = fileData?.repositoryFilePath ?? fileName;
        }

        item.description = `${activeUsers.length} editing`;
        return item;
    }

    static patch(conflictPatch: SharedPatch, repositoryRemoteUrl?: string, repositoryFilePath?: string): FileTreeItem {
        const { userName, baseCommit, committed } = conflictPatch;
        const timestamp = conflictPatch.timestamp.toISOString();
        const displayTime = new Date(timestamp).toLocaleTimeString();
        const label = `${userName} • ${baseCommit.slice(0, 8)} @ ${displayTime}`;
        const item = new FileTreeItem("patch", label, vscode.TreeItemCollapsibleState.None, undefined);

        if (committed) {
            // Remote tracking branch conflict (committed)
            item.iconPath = new vscode.ThemeIcon("git-commit", new vscode.ThemeColor("list.warningForeground"));
            item.tooltip = `Remote branch: ${userName}\nCommitted changes that conflict with your work`;
            item.description = "(committed)";
        } else {
            // Team member patch conflict (uncommitted)
            item.iconPath = new vscode.ThemeIcon("edit", new vscode.ThemeColor("list.errorForeground"));
            item.tooltip = `Team member: ${userName}\nUncommitted patch that conflicts with your work`;
            item.description = "(patch)";
        }

        item.command = {
            command: "work-share.openConflictDiff",
            title: "Open conflict diff",
            arguments: [
                {
                    patch: {
                        ...conflictPatch,
                        timestamp,
                    },
                    repositoryRemoteUrl,
                    repositoryFilePath,
                },
            ],
        };

        return item;
    }

    static status(label: string, level: "warning" | "error"): FileTreeItem {
        const item = new FileTreeItem("status", label, vscode.TreeItemCollapsibleState.None, undefined);
        item.iconPath = new vscode.ThemeIcon(level === "error" ? "error" : "warning");
        item.tooltip = label;
        return item;
    }

    static placeholder(label: string): FileTreeItem {
        const item = new FileTreeItem("placeholder", label, vscode.TreeItemCollapsibleState.None, undefined);
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
    }

    static context(label: string, iconId: string, tooltip: string): FileTreeItem {
        const item = new FileTreeItem("context", label, vscode.TreeItemCollapsibleState.None, undefined);
        item.iconPath = new vscode.ThemeIcon(iconId);
        item.tooltip = tooltip;
        return item;
    }

    static sharingStatus(isEnabled: boolean): FileTreeItem {
        const label = isEnabled ? "Sharing: On" : "Sharing: Off";
        const item = new FileTreeItem("sharing-status", label, vscode.TreeItemCollapsibleState.None, undefined);
        item.checkboxState = isEnabled ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
        item.tooltip =
            isEnabled ?
                "Sharing is enabled. Click to disable file activity tracking."
            :   "Sharing is disabled. Click to enable file activity tracking.";
        return item;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// ConflictTreeDataProvider — file-first conflict tree (workShareConflicts view)
// ────────────────────────────────────────────────────────────────────────────

type ConflictItemKind = "conflict-file" | "conflict-source" | "conflict-placeholder";

/** Single node in the conflict tree. */
class ConflictTreeItem extends vscode.TreeItem {
    public parent: ConflictTreeItem | undefined;

    constructor(
        public readonly kind: ConflictItemKind,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly repositoryFilePath?: string,
        public readonly conflictPatch?: SharedPatch,
    ) {
        super(label, collapsibleState);
    }

    /** File-level node with severity icon derived from the highest-severity child patch. */
    static file(repositoryFilePath: string, patches: SharedPatch[]): ConflictTreeItem {
        const fileName = repositoryFilePath.split("/").slice(-1)[0] ?? repositoryFilePath;
        const hasDefinite = patches.some((p) => p.severity === "definite" || p.committed);
        const hasLikely = patches.some((p) => p.severity === "likely");

        const item = new ConflictTreeItem(
            "conflict-file",
            fileName,
            vscode.TreeItemCollapsibleState.Expanded,
            repositoryFilePath,
        );
        item.description = repositoryFilePath;
        if (hasDefinite) {
            item.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("list.errorForeground"));
            item.tooltip = `Definite conflict detected — ${patches.length} source(s)\n${repositoryFilePath}`;
        } else if (hasLikely) {
            item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
            item.tooltip = `Likely conflict (nearby edits) — ${patches.length} source(s)\n${repositoryFilePath}`;
        } else {
            item.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("list.warningForeground"));
            item.tooltip = `Conflict source — ${patches.length} source(s)\n${repositoryFilePath}`;
        }
        return item;
    }

    /** Conflict source node representing one conflicting incoming patch. */
    static source(patch: SharedPatch, repositoryFilePath: string): ConflictTreeItem {
        const changeLabel =
            patch.committed ?
                `Remote: ${patch.userName}`
            : patch.changeType === "pending" ?
                `${patch.userName} — commit ${patch.commitShortSha ?? patch.baseCommit.slice(0, 8)}`
            :   `${patch.userName} — ${patch.workingState ?? "working"}`;
        const item = new ConflictTreeItem(
            "conflict-source",
            changeLabel,
            vscode.TreeItemCollapsibleState.None,
            repositoryFilePath,
            patch,
        );
        item.description = patch.commitMessage ?? (patch.committed ? "committed" : patch.workingState ?? "");

        const severity = patch.severity ?? (patch.committed ? "definite" : undefined);
        if (severity === "definite" || patch.committed) {
            item.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("list.errorForeground"));
            item.tooltip = `Definite conflict: ${changeLabel}`;
        } else if (severity === "likely") {
            item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
            item.tooltip = `Likely conflict (nearby edits): ${changeLabel}`;
        } else {
            item.iconPath = new vscode.ThemeIcon("circle-filled");
            item.tooltip = changeLabel;
        }

        item.command = {
            command: "work-share.openConflictDiff",
            title: "Open conflict diff",
            arguments: [
                {
                    patch: {
                        ...patch,
                        timestamp: patch.timestamp.toISOString(),
                    },
                    repositoryFilePath,
                },
            ],
        };
        return item;
    }

    static placeholder(label: string): ConflictTreeItem {
        const item = new ConflictTreeItem("conflict-placeholder", label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed"));
        return item;
    }
}

/**
 * Tree data provider for the Conflicts view (`workShareConflicts`).
 * Organized by file first; each file node expands to show conflicting patch sources.
 * Supports reveal-on-open so the active file's conflict node is highlighted automatically.
 */
export class ConflictTreeDataProvider implements vscode.TreeDataProvider<ConflictTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ConflictTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** Cache of file-level items keyed by repositoryFilePath for reveal operations. */
    private fileItemsByPath = new Map<string, ConflictTreeItem>();

    constructor(private tracker?: FileActivityTracker) {
        if (tracker) {
            tracker.onDidChangeConflictStatus(() => this.refresh());
        }
    }

    refresh(): void {
        this.fileItemsByPath.clear();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConflictTreeItem): vscode.TreeItem {
        return element;
    }

    getParent(element: ConflictTreeItem): vscode.ProviderResult<ConflictTreeItem | undefined> {
        return element.parent;
    }

    /**
     * Reveals the conflict tree node for the given repository-relative file path.
     * Called automatically when the active editor changes.
     */
    async revealFileByPath(
        treeView: vscode.TreeView<ConflictTreeItem | undefined>,
        repositoryFilePath: string,
    ): Promise<void> {
        const item = this.fileItemsByPath.get(repositoryFilePath);
        if (!item) {
            return;
        }
        try {
            await treeView.reveal(item, { select: true, focus: false, expand: true });
        } catch {
            // Ignore transient reveal errors.
        }
    }

    async getChildren(element?: ConflictTreeItem): Promise<ConflictTreeItem[]> {
        if (!element) {
            const allConflicts = this.tracker?.getAllProjectFileConflicts() ?? new Map<string, SharedPatch[]>();
            if (allConflicts.size === 0) {
                return [ConflictTreeItem.placeholder("No conflicts detected")];
            }

            return Array.from(allConflicts.entries()).map(([filePath, patches]) => {
                const node = ConflictTreeItem.file(filePath, patches);
                this.fileItemsByPath.set(filePath, node);
                return node;
            });
        }

        if (element.kind === "conflict-file" && element.repositoryFilePath) {
            const patches =
                this.tracker?.getAllProjectFileConflicts().get(element.repositoryFilePath) ?? [];
            return patches.map((patch) => {
                const child = ConflictTreeItem.source(patch, element.repositoryFilePath!);
                child.parent = element;
                return child;
            });
        }

        return [];
    }
}

// ────────────────────────────────────────────────────────────────────────────
// UserTreeDataProvider — user-first team activity tree (workShareUsers view)
// ────────────────────────────────────────────────────────────────────────────

type UserItemKind = "user" | "user-repo-branch" | "user-patch" | "user-placeholder";

/** Single node in the user activity tree. */
class UserTreeItem extends vscode.TreeItem {
    public parent: UserTreeItem | undefined;

    constructor(
        public readonly kind: UserItemKind,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly patch?: SharedPatch,
    ) {
        super(label, collapsibleState);
    }

    static userRoot(userName: string): UserTreeItem {
        const item = new UserTreeItem("user", userName, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon("account");
        item.tooltip = `Team member: ${userName}`;
        return item;
    }

    static repoBranchGroup(repoName: string, upstreamBranch: string | undefined): UserTreeItem {
        const label = upstreamBranch ? `${repoName} / ${upstreamBranch}` : repoName;
        const item = new UserTreeItem("user-repo-branch", label, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon("git-branch");
        item.tooltip = label;
        return item;
    }

    static patchLeaf(patch: SharedPatch): UserTreeItem {
        let label: string;
        let icon: string;
        let description: string;

        if (patch.changeType === "pending") {
            // Pending commit: show message + short SHA
            const sha = patch.commitShortSha ?? patch.commitSha?.slice(0, 8) ?? patch.baseCommit.slice(0, 8);
            label = patch.commitMessage ? `${patch.commitMessage} (${sha})` : sha;
            icon = "tag";
            description = patch.repositoryFilePath;
        } else {
            // Working change: show file path + staged/unstaged badge
            label = patch.repositoryFilePath.split("/").slice(-1)[0] ?? patch.repositoryFilePath;
            icon = patch.workingState === "staged" ? "debug-stackframe-focused" : "circle-outline";
            description = patch.workingState === "staged" ? "staged" : "unstaged";
        }

        const item = new UserTreeItem("user-patch", label, vscode.TreeItemCollapsibleState.None, patch);
        item.iconPath = new vscode.ThemeIcon(icon);
        item.description = description;
        item.tooltip = `${patch.userName} — ${patch.repositoryFilePath}`;
        item.command = {
            command: "work-share.openConflictDiff",
            title: "Open diff",
            arguments: [
                {
                    patch: { ...patch, timestamp: patch.timestamp.toISOString() },
                    repositoryFilePath: patch.repositoryFilePath,
                },
            ],
        };
        return item;
    }

    static placeholder(label: string): UserTreeItem {
        const item = new UserTreeItem("user-placeholder", label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
    }
}

/**
 * Tree data provider for the Team Activity view (`workShareUsers`).
 * Organized by user → repository/branch → pending commits and working changes.
 */
export class UserTreeDataProvider implements vscode.TreeDataProvider<UserTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<UserTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** In-memory cache of patches grouped by user for the current render cycle. */
    private patchesByUser: Map<string, SharedPatch[]> = new Map();
    /** Current user name to exclude own patches from the tree. */
    private currentUserName: string | undefined;

    constructor(
        private apiClient: ApiClient,
        private tracker?: FileActivityTracker,
    ) {
        apiClient.onDidChangeData(() => this.refresh());
        if (tracker) {
            tracker.onDidChangeConflictStatus(() => this.refresh());
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: UserTreeItem): vscode.TreeItem {
        return element;
    }

    getParent(element: UserTreeItem): vscode.ProviderResult<UserTreeItem | undefined> {
        return element.parent;
    }

    /** Reloads patches from the server and groups them by userName. */
    private async reloadPatches(): Promise<void> {
        this.currentUserName = await this.tracker?.getCurrentUserName();
        const repositoryRemoteUrl = await this.tracker?.getCurrentRepositoryRemoteUrl();
        const patches = await this.apiClient.getPatches({ repositoryRemoteUrl });

        this.patchesByUser.clear();
        for (const patch of patches) {
            if (patch.userName === this.currentUserName) {
                continue; // Skip own patches.
            }
            const existing = this.patchesByUser.get(patch.userName) ?? [];
            existing.push(patch);
            this.patchesByUser.set(patch.userName, existing);
        }
    }

    async getChildren(element?: UserTreeItem): Promise<UserTreeItem[]> {
        // Root: one node per distinct team member.
        if (!element) {
            await this.reloadPatches();

            if (this.patchesByUser.size === 0) {
                return [UserTreeItem.placeholder("No team activity yet")];
            }

            return Array.from(this.patchesByUser.keys()).map((userName) => {
                return UserTreeItem.userRoot(userName);
            });
        }

        // Under a user: one node per repository+upstream-branch group.
        if (element.kind === "user") {
            const userPatches = this.patchesByUser.get(element.label as string) ?? [];
            const groupKey = (p: SharedPatch) =>
                `${p.repositoryRemoteUrl}::${p.upstreamBranch ?? ""}`;

            const groups = new Map<string, SharedPatch[]>();
            for (const patch of userPatches) {
                const key = groupKey(patch);
                const existing = groups.get(key) ?? [];
                existing.push(patch);
                groups.set(key, existing);
            }

            return Array.from(groups.entries()).map(([, patches]) => {
                const first = patches[0];
                const repoName =
                    first?.repositoryRemoteUrl?.split("/").slice(-1)[0]?.replace(/\.git$/, "") ??
                    "unknown-repo";
                const upstreamBranch = first?.upstreamBranch;
                const groupNode = UserTreeItem.repoBranchGroup(repoName, upstreamBranch);
                groupNode.parent = element;
                // Attach patches as context for the next level.
                (groupNode as UserTreeItem & { _patches?: SharedPatch[] })._patches = patches;
                return groupNode;
            });
        }

        // Under a repo/branch group: leaf patches.
        if (element.kind === "user-repo-branch") {
            const patches = (element as UserTreeItem & { _patches?: SharedPatch[] })._patches ?? [];
            return patches.map((patch) => {
                const leaf = UserTreeItem.patchLeaf(patch);
                leaf.parent = element;
                return leaf;
            });
        }

        return [];
    }
}
