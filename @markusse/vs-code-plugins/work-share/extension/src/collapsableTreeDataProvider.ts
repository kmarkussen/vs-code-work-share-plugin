import * as vscode from "vscode";

/**
 * Constraint interface for tree items that support parent tracking and compact-folder construction.
 * Implementing classes declare a mutable `parent` property for reveal operations.
 */
export interface CollapsableTreeItem<T> extends vscode.TreeItem {
    parent?: T;
}

/**
 * Abstract base class providing compact-folder tree construction for VS Code TreeDataProviders.
 *
 * Compact folders collapse linear single-child directory chains into a single node
 * (e.g. `src/` → `features/` becomes `src/features`), matching the VS Code Explorer behavior.
 *
 * Subclasses must implement three factory methods that map raw leaf data to tree items.
 *
 * @template TItem The tree item type. Must carry an optional `parent` reference.
 * @template TLeaf The raw leaf data type (e.g. a patch or file descriptor).
 */
export abstract class CollapsableTreeDataProvider<
    TItem extends CollapsableTreeItem<TItem>,
    TLeaf,
> implements vscode.TreeDataProvider<TItem> {
    abstract readonly onDidChangeTreeData: vscode.Event<TItem | undefined | void>;

    abstract getTreeItem(element: TItem): vscode.TreeItem | Thenable<vscode.TreeItem>;
    abstract getChildren(element?: TItem): vscode.ProviderResult<TItem[]>;

    /** Returns the repository-relative file path for a leaf data object. */
    protected abstract getLeafPath(leaf: TLeaf): string;

    /** Creates a leaf tree item from the raw leaf data. */
    protected abstract createLeafItem(leaf: TLeaf): TItem;

    /**
     * Creates a directory tree item for a compact-folder node.
     * @param label  The compacted display label (e.g. `"src/features"`).
     * @param pathPrefix  The full path prefix this directory represents.
     * @param leaves  All leaf data objects beneath this directory.
     */
    protected abstract createDirectoryItem(label: string, pathPrefix: string, leaves: TLeaf[]): TItem;

    /**
     * Sorts the leaf items before they are appended to the child list.
     * Override to customise sort order; default is alphabetical by label.
     */
    protected sortLeafItems(items: TItem[]): TItem[] {
        return items.sort((a, b) => String(a.label).localeCompare(String(b.label)));
    }

    /**
     * Splits a flat list of leaves at one path depth into direct leaf items and
     * subdirectory buckets. Leaves whose path has only one remaining segment become
     * leaf items; deeper paths are grouped under their next directory segment.
     */
    protected collectPathLevel(
        leaves: TLeaf[],
        parentPath = "",
    ): { directoryLeaves: Map<string, TLeaf[]>; leafItems: TItem[] } {
        const directoryLeaves = new Map<string, TLeaf[]>();
        const leafItems: TItem[] = [];

        for (const leaf of leaves) {
            const normalizedFilePath = this.getLeafPath(leaf).replace(/^\/+/, "");
            const relativePath =
                parentPath && normalizedFilePath.startsWith(`${parentPath}/`) ?
                    normalizedFilePath.slice(parentPath.length + 1)
                :   normalizedFilePath;
            const segments = relativePath.split("/").filter(Boolean);

            if (segments.length === 0) {
                continue;
            }

            if (segments.length === 1) {
                leafItems.push(this.createLeafItem(leaf));
                continue;
            }

            // Group this leaf under the next path segment, building the full sub-path key.
            const nextPath = parentPath ? `${parentPath}/${segments[0]}` : segments[0];
            const existing = directoryLeaves.get(nextPath) ?? [];
            existing.push(leaf);
            directoryLeaves.set(nextPath, existing);
        }

        return { directoryLeaves, leafItems };
    }

    /**
     * Walks down a chain of single-child directories until a branch point or a direct
     * leaf is encountered, then returns a compacted label relative to `parentPath`.
     * For example `src/` → `features/` compacts to the label `"src/features"`.
     */
    protected getCompactedDirectory(
        pathPrefix: string,
        leaves: TLeaf[],
        parentPath = "",
    ): { label: string; pathPrefix: string } {
        let compactedPath = pathPrefix;
        let currentLeaves = leaves;

        for (;;) {
            const { directoryLeaves, leafItems } = this.collectPathLevel(currentLeaves, compactedPath);
            // Stop compacting when there are direct leaves or more than one subdirectory.
            if (leafItems.length > 0 || directoryLeaves.size !== 1) {
                break;
            }

            const [nextPath, nextLeaves] = Array.from(directoryLeaves.entries())[0];
            compactedPath = nextPath;
            currentLeaves = nextLeaves;
        }

        return {
            label: compactedPath.slice(parentPath.length).replace(/^\//, "") || compactedPath,
            pathPrefix: compactedPath,
        };
    }

    /**
     * Builds the full child list for a tree node from a flat list of leaves.
     * Applies compact-folder logic and assigns `parent` references for reveal support.
     * Returns directory nodes (sorted alphabetically) followed by sorted leaf nodes.
     */
    protected buildPathChildren(parent: TItem, leaves: TLeaf[], parentPath = ""): TItem[] {
        const { directoryLeaves, leafItems } = this.collectPathLevel(leaves, parentPath);

        for (const leaf of leafItems) {
            leaf.parent = parent;
        }

        const directoryItems = Array.from(directoryLeaves.entries())
            .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
            .map(([pathPrefix, childLeaves]) => {
                const compacted = this.getCompactedDirectory(pathPrefix, childLeaves, parentPath);
                const directory = this.createDirectoryItem(compacted.label, compacted.pathPrefix, childLeaves);
                directory.parent = parent;
                return directory;
            });

        const sortedLeaves = this.sortLeafItems(leafItems);
        return [...directoryItems, ...sortedLeaves];
    }
}
