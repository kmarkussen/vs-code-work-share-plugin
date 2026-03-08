import * as vscode from "vscode";
import * as path from "path";
import { FileActivityTracker, FileActivity, ConflictStatus } from "./fileActivityTracker";
import { ApiClient } from "./apiClient";

interface RepositoryScope {
    repositoryRemoteUrl: string | undefined;
    activities: FileActivity[];
}

interface DirectoryTree {
    directories: Map<string, DirectoryTree>;
    files: Map<string, FileActivity[]>;
}

interface FileConflictPresentation {
    status: ConflictStatus;
    tooltip: string;
}

type TreeItemKind =
    | "repository"
    | "user"
    | "directory"
    | "file"
    | "activity"
    | "placeholder"
    | "status"
    | "context"
    | "sharing-status";

/**
 * Provides tree view items backed by local tracker state and server activity.
 */
export class ActivityTreeDataProvider implements vscode.TreeDataProvider<WorkShareTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkShareTreeItem | undefined | void> = new vscode.EventEmitter<
        WorkShareTreeItem | undefined | void
    >();
    readonly onDidChangeTreeData: vscode.Event<WorkShareTreeItem | undefined | void> = this._onDidChangeTreeData.event;
    private conflictStatusesByRepositoryFilePath: Map<string, ConflictStatus> = new Map();
    private lastConflictStatusRefreshAt = 0;

    /**
     * Cache of file tree items by workspace-relative path.
     * Enables reveal() to work with the exact same object instances created by getChildren().
     */
    private fileItemsByRelativePath: Map<string, WorkShareTreeItem> = new Map();

    constructor(
        private tracker: FileActivityTracker,
        private apiClient: ApiClient,
    ) {
        // Refresh tree view periodically
        setInterval(() => {
            this.refresh();
        }, 2000);
    }

    /**
     * Merges local and server activities, then deduplicates and sorts newest first.
     */
    private mergeActivities(localActivities: FileActivity[], serverActivities: FileActivity[]): FileActivity[] {
        const merged = [...serverActivities, ...localActivities];
        const deduped = new Map<string, FileActivity>();

        for (const activity of merged) {
            const key = [
                activity.repositoryRemoteUrl,
                activity.userName,
                activity.filePath,
                activity.action,
                activity.timestamp.toISOString(),
            ].join("|");
            deduped.set(key, activity);
        }

        return Array.from(deduped.values()).sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());
    }

    /**
     * Resolves all activities scoped to the currently active repository.
     */
    private async getScopedActivities(): Promise<RepositoryScope> {
        const repositoryRemoteUrl = await this.tracker.getCurrentRepositoryRemoteUrl();
        const localActivities = await this.tracker.getActivities();

        if (!repositoryRemoteUrl) {
            return { repositoryRemoteUrl: undefined, activities: localActivities };
        }

        // Query server using current repository to keep cross-user activity scoped correctly.
        const serverActivities = await this.apiClient.getActivities({ repositoryRemoteUrl });
        const mergedActivities = this.mergeActivities(localActivities, serverActivities);

        await this.refreshConflictStatuses(repositoryRemoteUrl, mergedActivities);
        return {
            repositoryRemoteUrl,
            activities: mergedActivities,
        };
    }

    /**
     * Refreshes conflict statuses with light throttling to avoid expensive git checks on every render.
     */
    private async refreshConflictStatuses(
        repositoryRemoteUrl: string | undefined,
        activities: FileActivity[],
    ): Promise<void> {
        if (Date.now() - this.lastConflictStatusRefreshAt < 5000) {
            return;
        }

        this.lastConflictStatusRefreshAt = Date.now();
        const uniqueRepositoryFiles = Array.from(
            new Set(activities.map((activity) => this.getRelativeFilePath(activity.filePath))),
        );

        this.conflictStatusesByRepositoryFilePath = await this.tracker.getConflictStatusesForFiles(
            repositoryRemoteUrl,
            uniqueRepositoryFiles,
        );
    }

    /**
     * Computes the combined conflict presentation for a tree file node.
     */
    private getFileConflictPresentation(
        repositoryRemoteUrl: string | undefined,
        repositoryFilePath: string,
        fileName: string,
        activityCount: number,
    ): FileConflictPresentation {
        const patchStatus = this.conflictStatusesByRepositoryFilePath.get(repositoryFilePath) ?? "unknown";
        const remoteStatus = this.tracker.getKnownRemoteConflictStatus(repositoryRemoteUrl, repositoryFilePath);
        const status =
            patchStatus === "conflict" || remoteStatus === "conflict" ? "conflict"
            : patchStatus === "clean" && (remoteStatus === "clean" || remoteStatus === undefined) ? "clean"
            : "unknown";

        if (patchStatus === "conflict" && remoteStatus === "conflict") {
            return {
                status,
                tooltip: `${fileName} has possible merge conflicts from shared patches and remote tracking branch updates.`,
            };
        }

        if (patchStatus === "conflict") {
            return {
                status,
                tooltip: `${fileName} has possible incoming merge conflicts from shared patches.`,
            };
        }

        if (remoteStatus === "conflict") {
            return {
                status,
                tooltip: `${fileName} has possible merge conflicts from remote tracking branch updates.`,
            };
        }

        if (remoteStatus === "unknown") {
            return {
                status,
                tooltip: `${fileName} has ${activityCount} tracked events. Remote tracking conflict status is unavailable.`,
            };
        }

        return {
            status,
            tooltip: `${fileName} has ${activityCount} tracked events.`,
        };
    }

    /**
     * Builds a directory tree from user activities using workspace-relative paths.
     */
    private buildDirectoryTree(activities: FileActivity[]): DirectoryTree {
        const root: DirectoryTree = {
            directories: new Map<string, DirectoryTree>(),
            files: new Map<string, FileActivity[]>(),
        };

        for (const activity of activities) {
            const relativeFilePath = this.getRelativeFilePath(activity.filePath);
            const pathSegments = relativeFilePath.split("/").filter((segment) => segment.length > 0);
            const fileName = pathSegments.pop() ?? path.basename(activity.filePath);

            let currentNode = root;
            for (const directorySegment of pathSegments) {
                if (!currentNode.directories.has(directorySegment)) {
                    currentNode.directories.set(directorySegment, {
                        directories: new Map<string, DirectoryTree>(),
                        files: new Map<string, FileActivity[]>(),
                    });
                }

                currentNode = currentNode.directories.get(directorySegment)!;
            }

            if (!currentNode.files.has(fileName)) {
                currentNode.files.set(fileName, []);
            }

            currentNode.files.get(fileName)!.push(activity);
        }

        return root;
    }

    /**
     * Returns a stable repository label from remote URL for top-level tree display.
     */
    private getRepositoryLabel(repositoryRemoteUrl: string | undefined): string {
        if (!repositoryRemoteUrl) {
            return "No active repository";
        }

        const normalized = repositoryRemoteUrl.replace(/\.git$/, "");
        const segments = normalized.split("/").filter((segment) => segment.length > 0);
        const repositoryName = segments[segments.length - 1] ?? repositoryRemoteUrl;
        return `Repository: ${repositoryName}`;
    }

    /**
     * Converts absolute file paths into workspace-relative paths for cleaner tree grouping.
     */
    private getRelativeFilePath(filePath: string): string {
        const fileUri = vscode.Uri.file(filePath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
        if (!workspaceFolder) {
            return path.basename(filePath);
        }

        return path.relative(workspaceFolder.uri.fsPath, filePath).replace(/\\/g, "/");
    }

    /**
     * Triggers a tree refresh event and clears the file cache.
     */
    refresh(): void {
        this.fileItemsByRelativePath.clear();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Reveals and selects the file node that matches the active editor file path.
     * Uses cached file items for guaranteed reveal compatibility with VS Code tree view.
     */
    async revealActiveFile(treeView: vscode.TreeView<WorkShareTreeItem>, activeFilePath: string): Promise<void> {
        const activeRelativePath = this.getRelativeFilePath(activeFilePath);
        const fileItem = this.fileItemsByRelativePath.get(activeRelativePath);
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
            // Ignore transient reveal errors while the tree is still rendering.
        }
    }

    getTreeItem(element: WorkShareTreeItem): vscode.TreeItem {
        return element;
    }

    getParent(element: WorkShareTreeItem): vscode.ProviderResult<WorkShareTreeItem> {
        return element.parent;
    }

    /**
     * Resolves children as a hierarchical tree: repository → users → directories → files → activity events.
     */
    getChildren(element?: WorkShareTreeItem): Thenable<WorkShareTreeItem[]> {
        if (!element) {
            return this.getScopedActivities().then(async ({ repositoryRemoteUrl, activities }) => {
                const currentUserName = await this.tracker.getCurrentUserName();
                const repositoryLabel = this.getRepositoryLabel(repositoryRemoteUrl);
                const isActivelySharing = await this.tracker.isActivelySharingActivity();

                const rootItems = [
                    WorkShareTreeItem.sharingStatus(isActivelySharing),
                    WorkShareTreeItem.context(
                        `Current User: ${currentUserName}`,
                        "account",
                        "User identity used when posting activity and patches.",
                    ),
                    WorkShareTreeItem.context(
                        repositoryLabel,
                        "repo",
                        repositoryRemoteUrl ?? "No active repository detected from current workspace/editor context.",
                    ),
                    WorkShareTreeItem.repository(repositoryLabel, repositoryRemoteUrl, activities),
                ];

                const connectionIssue = this.apiClient.getConnectionIssue();
                if (connectionIssue) {
                    rootItems.unshift(WorkShareTreeItem.status(connectionIssue.message, connectionIssue.level));
                }

                rootItems.forEach((item) => {
                    item.parent = undefined;
                });

                return rootItems;
            });
        }

        if (element.kind === "repository") {
            const activities = element.activities ?? [];
            if (activities.length === 0) {
                return Promise.resolve([WorkShareTreeItem.placeholder("No activity found for this repository")]);
            }

            const activitiesByUser = new Map<string, FileActivity[]>();
            for (const activity of activities) {
                if (!activitiesByUser.has(activity.userName)) {
                    activitiesByUser.set(activity.userName, []);
                }

                activitiesByUser.get(activity.userName)!.push(activity);
            }

            return this.tracker.getCurrentUserName().then((currentUserName) => {
                const userItems = Array.from(activitiesByUser.entries())
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([userName, userActivities]) =>
                        WorkShareTreeItem.user(userName, userActivities, userName === currentUserName),
                    );

                userItems.forEach((item) => {
                    item.parent = element;
                });

                return userItems;
            });
        }

        if (element.kind === "user") {
            const activities = element.activities ?? [];
            const directoryTree = this.buildDirectoryTree(activities);

            const directoryItems = Array.from(directoryTree.directories.entries())
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([directoryName, subtree]) => WorkShareTreeItem.directory(directoryName, subtree));

            const fileItems = Array.from(directoryTree.files.entries())
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([fileName, fileActivities]) => {
                    const repositoryFilePath = this.getRelativeFilePath(fileActivities[0].filePath);
                    const conflictPresentation = this.getFileConflictPresentation(
                        fileActivities[0].repositoryRemoteUrl,
                        repositoryFilePath,
                        fileName,
                        fileActivities.length,
                    );
                    const fileItem = WorkShareTreeItem.file(fileName, fileActivities, conflictPresentation);
                    // Cache file item for reveal()
                    this.fileItemsByRelativePath.set(repositoryFilePath, fileItem);
                    return fileItem;
                });

            directoryItems.forEach((item) => {
                item.parent = element;
            });
            fileItems.forEach((item) => {
                item.parent = element;
            });

            return Promise.resolve([...directoryItems, ...fileItems]);
        }

        if (element.kind === "directory") {
            const directoryTree = element.directoryTree;
            if (!directoryTree) {
                return Promise.resolve([]);
            }

            const directoryItems = Array.from(directoryTree.directories.entries())
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([directoryName, subtree]) => WorkShareTreeItem.directory(directoryName, subtree));

            const fileItems = Array.from(directoryTree.files.entries())
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([fileName, fileActivities]) => {
                    const repositoryFilePath = this.getRelativeFilePath(fileActivities[0].filePath);
                    const conflictPresentation = this.getFileConflictPresentation(
                        fileActivities[0].repositoryRemoteUrl,
                        repositoryFilePath,
                        fileName,
                        fileActivities.length,
                    );
                    const fileItem = WorkShareTreeItem.file(fileName, fileActivities, conflictPresentation);
                    // Cache file item for reveal()
                    this.fileItemsByRelativePath.set(repositoryFilePath, fileItem);
                    return fileItem;
                });

            directoryItems.forEach((item) => {
                item.parent = element;
            });
            fileItems.forEach((item) => {
                item.parent = element;
            });

            return Promise.resolve([...directoryItems, ...fileItems]);
        }

        if (element.kind === "file") {
            const activities = (element.activities ?? []).sort(
                (left, right) => right.timestamp.getTime() - left.timestamp.getTime(),
            );
            const activityItems = activities.map((activity) => WorkShareTreeItem.activity(activity));
            activityItems.forEach((item) => {
                item.parent = element;
            });

            return Promise.resolve(activityItems);
        }

        return Promise.resolve([]);
    }
}

/**
 * Tree item model used for repository, user, directory, file, and activity nodes.
 */
class WorkShareTreeItem extends vscode.TreeItem {
    public parent: WorkShareTreeItem | undefined;

    constructor(
        public readonly kind: TreeItemKind,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly repositoryRemoteUrl?: string,
        public readonly activities?: FileActivity[],
        public readonly directoryTree?: DirectoryTree,
        public readonly activity?: FileActivity,
    ) {
        super(label, collapsibleState);
    }

    static repository(
        label: string,
        repositoryRemoteUrl: string | undefined,
        activities: FileActivity[],
    ): WorkShareTreeItem {
        const item = new WorkShareTreeItem(
            "repository",
            label,
            vscode.TreeItemCollapsibleState.Expanded,
            repositoryRemoteUrl,
            activities,
        );
        item.iconPath = new vscode.ThemeIcon("repo");
        item.tooltip = repositoryRemoteUrl ?? "No active repository detected";
        return item;
    }

    static user(userName: string, activities: FileActivity[], isCurrentUser = false): WorkShareTreeItem {
        const item = new WorkShareTreeItem(
            "user",
            isCurrentUser ? `${userName} (You)` : userName,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            activities,
        );
        item.iconPath = new vscode.ThemeIcon("account");
        item.description = `${activities.length} activities`;
        item.tooltip = `${userName} contributed ${activities.length} activities.`;
        return item;
    }

    static directory(directoryName: string, directoryTree: DirectoryTree): WorkShareTreeItem {
        const item = new WorkShareTreeItem(
            "directory",
            directoryName,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            undefined,
            directoryTree,
        );
        item.iconPath = new vscode.ThemeIcon("folder");
        return item;
    }

    static file(
        fileName: string,
        activities: FileActivity[],
        conflictPresentation: FileConflictPresentation,
    ): WorkShareTreeItem {
        const item = new WorkShareTreeItem(
            "file",
            fileName,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            activities,
        );
        item.iconPath = new vscode.ThemeIcon(conflictPresentation.status === "conflict" ? "warning" : "file");
        item.description = `${activities.length} events`;
        item.tooltip = conflictPresentation.tooltip;
        return item;
    }

    static activity(activity: FileActivity): WorkShareTreeItem {
        const label = `${activity.action} • ${activity.timestamp.toLocaleString()}`;
        const item = new WorkShareTreeItem(
            "activity",
            label,
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            undefined,
            activity,
        );
        item.description = path.basename(activity.filePath);
        item.tooltip = `${activity.userName} ${activity.action} ${activity.filePath}`;
        item.resourceUri = vscode.Uri.file(activity.filePath);
        item.command = {
            command: "vscode.open",
            title: "Open File",
            arguments: [vscode.Uri.file(activity.filePath)],
        };
        item.iconPath = new vscode.ThemeIcon(
            activity.action === "open" ? "file"
            : activity.action === "edit" ? "edit"
            : "close",
        );
        return item;
    }

    static placeholder(label: string): WorkShareTreeItem {
        const item = new WorkShareTreeItem("placeholder", label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
    }

    static status(label: string, level: "warning" | "error"): WorkShareTreeItem {
        const item = new WorkShareTreeItem("status", label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(level === "error" ? "error" : "warning");
        item.tooltip = label;
        return item;
    }

    static sharingStatus(isActivelySharing: boolean): WorkShareTreeItem {
        const label = isActivelySharing ? "● Sharing Activity (Active)" : "● Sharing Activity (Inactive)";
        const item = new WorkShareTreeItem("sharing-status", label, vscode.TreeItemCollapsibleState.None);

        if (isActivelySharing) {
            item.iconPath = new vscode.ThemeIcon("pass");
            item.tooltip = "✓ User identity resolved. Activity is being shared.";
        } else {
            item.iconPath = new vscode.ThemeIcon("warning");
            item.tooltip = "⚠ User identity not resolved. Set workShare.userName or git user.name to enable sharing.";
        }

        return item;
    }

    static context(label: string, iconId: string, tooltip: string): WorkShareTreeItem {
        const item = new WorkShareTreeItem("context", label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(iconId);
        item.tooltip = tooltip;
        return item;
    }
}
