/**
 * Returns true when the path points to a git internal file/directory.
 */
export function isGitInternalPath(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, "/");
    return normalizedPath.includes("/.git/") || normalizedPath.endsWith("/.git") || normalizedPath.endsWith(".git");
}
