import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { OutputLogger } from "./outputLogger";
import { ConflictStatus, FileActivityTracker } from "./fileActivityTracker";
import { SharedPatch } from "./sharedPatch";

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

    /**
     * Resolves combined conflict state for a repository file from patch and remote signals.
     * Delegates to tracker for authoritative conflict status determination.
     */
    private async getCombinedConflictStatus(
        repositoryRemoteUrl: string,
        repositoryFilePath: string,
    ): Promise<ConflictStatus> {
        if (!this.tracker) {
            return "unknown";
        }

        return await this.tracker.getCombinedConflictStatusForRepositoryFile(repositoryRemoteUrl, repositoryFilePath);
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

        const items: FileTreeItem[] = [
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
        if (element?.kind === "status-group") {
            const statusItems = element.statusItems ?? [];
            statusItems.forEach((item) => {
                item.parent = element;
            });
            return statusItems;
        }

        // Root: fetch repositories and files
        if (!element) {
            const rootItems: FileTreeItem[] = [];
            const statusItems = await this.getStatusSectionItems();
            rootItems.push(FileTreeItem.statusGroup(statusItems));

            try {
                const repos = await this.apiClient.getFiles();

                if (repos.length === 0) {
                    rootItems.push(FileTreeItem.placeholder("No active files right now"));
                    return rootItems;
                }

                for (const repo of repos) {
                    const repoItem = FileTreeItem.repository(repo.repositoryName, repo.repositoryRemoteUrl, repo.files);
                    repoItem.parent = undefined;
                    rootItems.push(repoItem);
                }

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

            // Patches - show conflict-causing patches if available
            const conflictPatches = element.conflictPatches;
            if (conflictPatches && conflictPatches.length > 0) {
                for (const patch of conflictPatches) {
                    const patchItem = FileTreeItem.patch(
                        patch,
                        element.repositoryRemoteUrl,
                        element.repositoryFilePath,
                    );
                    patchItem.parent = element;
                    children.push(patchItem);
                }
            } else if (element.patches && element.patches.length > 0) {
                // Fallback to regular patches if no conflicts
                for (const patch of element.patches) {
                    const patchItem = FileTreeItem.patch(
                        {
                            repositoryRemoteUrl: patch.repositoryRemoteUrl,
                            userName: patch.userName,
                            repositoryFilePath: patch.repositoryFilePath,
                            baseCommit: patch.baseCommit,
                            patch: patch.patch,
                            timestamp: new Date(patch.timestamp),
                            committed: false,
                        },
                        element.repositoryRemoteUrl,
                        element.repositoryFilePath,
                    );
                    patchItem.parent = element;
                    children.push(patchItem);
                }
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
        const item = new FileTreeItem("status-group", "Status", vscode.TreeItemCollapsibleState.Expanded, statusItems);
        item.iconPath = new vscode.ThemeIcon("info");
        item.tooltip = "Connection, identity, and remote conflict availability status.";
        return item;
    }

    static repository(
        name: string,
        remoteUrl: string | undefined,
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
        const item = new FileTreeItem("repository", name, vscode.TreeItemCollapsibleState.Expanded, undefined, files);
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
}
