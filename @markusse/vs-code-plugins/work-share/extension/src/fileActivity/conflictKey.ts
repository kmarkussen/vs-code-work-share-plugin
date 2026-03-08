/**
 * Normalizes repository file paths so conflict keys stay stable across callers.
 *
 * Normalization steps:
 * 1. Trim whitespace and strip surrounding single/double quotes.
 * 2. Convert backslashes to forward slashes and collapse duplicate separators.
 * 3. Remove a leading "./" when present.
 * 4. If the path contains a scoped segment (e.g. "/@org/project/..."), keep only that suffix
 *    so absolute paths from different clone roots resolve to the same repository-relative value.
 * 5. Otherwise remove a leading "/" to avoid absolute-vs-relative representation drift.
 */
function normalizeRepositoryFilePath(repositoryFilePath: string): string {
    const trimmed = repositoryFilePath.trim().replace(/^['"]+|['"]+$/g, "");
    const normalizedSlashes = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");

    // If the path contains a scoped package marker (e.g. @org/project), use that suffix for cross-clone stability.
    const scopedSegmentMatch = normalizedSlashes.match(/\/(@[^/]+\/.*)$/);
    if (scopedSegmentMatch) {
        return scopedSegmentMatch[1];
    }

    // Keep absolute-path leading slash out of key material to avoid representation drift.
    return normalizedSlashes.replace(/^\//, "");
}

/**
 * Builds a stable key for repository-scoped file conflict state.
 * The repository file path is normalized before composing the key.
 */
export function getRepositoryFileConflictKey(
    repositoryRemoteUrl: string | undefined,
    repositoryFilePath: string | undefined,
): string | undefined {
    if (!repositoryRemoteUrl || !repositoryFilePath) {
        return undefined;
    }

    return `${repositoryRemoteUrl}::${normalizeRepositoryFilePath(repositoryFilePath)}`;
}
