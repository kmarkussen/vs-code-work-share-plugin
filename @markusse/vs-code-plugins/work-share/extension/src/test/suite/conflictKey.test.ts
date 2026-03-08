import * as assert from "assert";
import { getRepositoryFileConflictKey } from "../../fileActivity/conflictKey";

suite("ConflictKey Test Suite", () => {
    test("getRepositoryFileConflictKey should normalize absolute and repository-relative paths to same key", () => {
        const repositoryRemoteUrl = "https://github.com/org/repo.git";
        const relativePath = "@markusse/vs-code-plugins/work-share/dummyContent.txt";
        const absolutePath =
            "/home/markusse/projects/vs-code-plugins/work-share-copy/@markusse/vs-code-plugins/work-share/dummyContent.txt";

        const relativeKey = getRepositoryFileConflictKey(repositoryRemoteUrl, relativePath);
        const absoluteKey = getRepositoryFileConflictKey(repositoryRemoteUrl, absolutePath);

        assert.strictEqual(absoluteKey, relativeKey);
    });

    test("getRepositoryFileConflictKey should normalize quotes and windows separators", () => {
        const repositoryRemoteUrl = "https://github.com/org/repo.git";
        const quotedWindowsStylePath =
            "'C:\\Users\\dev\\repo-copy\\@markusse\\vs-code-plugins\\work-share\\dummyContent.txt'";

        const key = getRepositoryFileConflictKey(repositoryRemoteUrl, quotedWindowsStylePath);

        assert.strictEqual(
            key,
            "https://github.com/org/repo.git::@markusse/vs-code-plugins/work-share/dummyContent.txt",
        );
    });

    test("getRepositoryFileConflictKey should return undefined when inputs are missing", () => {
        assert.strictEqual(getRepositoryFileConflictKey(undefined, "file.ts"), undefined);
        assert.strictEqual(getRepositoryFileConflictKey("https://github.com/org/repo.git", undefined), undefined);
    });
});
