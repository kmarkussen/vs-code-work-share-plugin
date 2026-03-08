import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { OutputLogger } from "./outputLogger";

type TreeItemKind = "repository" | "file" | "user" | "patch" | "placeholder" | "status" | "context" | "sharing-status";

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
        private logger?: OutputLogger,
    ) {
        // Refresh tree periodically
        setInterval(() => {
            this.refresh();
        }, 2000);
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
            const connectionIssue = this.apiClient.getConnectionIssue();
            const rootItems: FileTreeItem[] = [];

            if (connectionIssue) {
                rootItems.push(
                    FileTreeItem.status(
                        connectionIssue.message,
                        connectionIssue.level === "error" ? "error" : "warning",
                    ),
                );
            }

            try {
                const repos = await this.apiClient.getFiles();

                if (repos.length === 0) {
                    if (!connectionIssue) {
                        rootItems.push(
                            FileTreeItem.context(
                                "Connected to Work Share API",
                                "plug",
                                "No active files are being edited right now.",
                            ),
                        );
                    }
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
                if (rootItems.length === 0) {
                    rootItems.push(
                        FileTreeItem.status("Failed to load file activity. Check Work Share API connection.", "error"),
                    );
                }
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

            const fileItems = files.map((file) => {
                const fileItem = FileTreeItem.file(file.repositoryFileName, file.activeUsers, file.patches, file);
                fileItem.parent = element;
                const cacheKey = `${file.repositoryRemoteUrl}:${file.repositoryFilePath}`;
                this.fileItemsByPath.set(cacheKey, fileItem);
                return fileItem;
            });

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

            // Patches
            if (element.patches && element.patches.length > 0) {
                for (const patch of element.patches) {
                    const patchItem = FileTreeItem.patch(patch.userName, patch.baseCommit, patch.timestamp);
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
    ) {
        super(label, collapsibleState);
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
        const item = new FileTreeItem("repository", name, vscode.TreeItemCollapsibleState.Expanded, files);
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
    ): FileTreeItem {
        const item = new FileTreeItem(
            "file",
            fileName,
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            activeUsers,
            patches,
        );
        item.iconPath = new vscode.ThemeIcon("file");
        item.description = `${activeUsers.length} editing`;
        item.tooltip = fileData?.repositoryFilePath ?? fileName;
        return item;
    }

    static patch(userName: string, baseCommit: string, timestamp: string): FileTreeItem {
        const displayTime = new Date(timestamp).toLocaleTimeString();
        const label = `${userName} • ${baseCommit.slice(0, 8)} @ ${displayTime}`;
        const item = new FileTreeItem("patch", label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("edit");
        item.tooltip = `Patch by ${userName}`;
        return item;
    }

    static status(label: string, level: "warning" | "error"): FileTreeItem {
        const item = new FileTreeItem("status", label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(level === "error" ? "error" : "warning");
        item.tooltip = label;
        return item;
    }

    static placeholder(label: string): FileTreeItem {
        const item = new FileTreeItem("placeholder", label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
    }

    static context(label: string, iconId: string, tooltip: string): FileTreeItem {
        const item = new FileTreeItem("context", label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(iconId);
        item.tooltip = tooltip;
        return item;
    }
}
