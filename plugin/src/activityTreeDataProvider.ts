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

type TreeItemKind = "repository" | "user" | "directory" | "file" | "activity" | "placeholder" | "status" | "context" | "sharing-status";

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
     * Triggers a tree refresh event.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkShareTreeItem): vscode.TreeItem {
        return element;
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
                    return WorkShareTreeItem.file(
                        fileName,
                        fileActivities,
                        this.conflictStatusesByRepositoryFilePath.get(repositoryFilePath) ?? "unknown",
                    );
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
                    return WorkShareTreeItem.file(
                        fileName,
                        fileActivities,
                        this.conflictStatusesByRepositoryFilePath.get(repositoryFilePath) ?? "unknown",
                    );
                });

            return Promise.resolve([...directoryItems, ...fileItems]);
        }

        if (element.kind === "file") {
            const activities = (element.activities ?? []).sort(
                (left, right) => right.timestamp.getTime() - left.timestamp.getTime(),
            );

            return Promise.resolve(activities.map((activity) => WorkShareTreeItem.activity(activity)));
        }

        return Promise.resolve([]);
    }
}

/**
 * Tree item model used for repository, user, directory, file, and activity nodes.
 */
class WorkShareTreeItem extends vscode.TreeItem {
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

    static file(fileName: string, activities: FileActivity[], conflictStatus: ConflictStatus): WorkShareTreeItem {
        const item = new WorkShareTreeItem(
            "file",
            fileName,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            activities,
        );
        item.iconPath = new vscode.ThemeIcon(conflictStatus === "conflict" ? "warning" : "file");
        item.description = `${activities.length} events`;
        item.tooltip =
            conflictStatus === "conflict" ?
                `${fileName} has possible incoming merge conflicts from shared patches.`
            :   `${fileName} has ${activities.length} tracked events.`;
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
