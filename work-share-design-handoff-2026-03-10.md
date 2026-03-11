# Work Share design handoff - 2026-03-10

## Purpose

Repository-scoped handoff notes for resuming the design/planning conversation around the README `Design Use Cases` section.

## Confirmed requirements

- `Pending Commits` should be shared as one patch per commit.
- `Pending Commits` should include commit message and short SHA for presentation.
- UI may expand commit nodes to reveal fuller commit details when appropriate.
- `Working Changes` should include both staged and unstaged changes.
- File status precedence:
    - Primary: `updated` if there is at least one pending commit.
    - Secondary badge: `editing` if working changes also exist.
- Conflict checks on file open should default to patches from the same `upstreamBranch` only.
- UI should provide a toggle to show patches from all branches.
- Conflict modeling goal:
    - predict conflicts that will occur during rebase,
    - specifically local pending commits rebased onto remote-ahead commits,
    - then local working changes applied on top of that rebased result.
- Rebase conflict analysis should operate across the aggregate resulting diff while still showing individual commits in the UI.
- Initial full sync should apply to the current repository only.
- "Current repository" means the active git repository at the root directory of the VS Code workspace.
- If the first opened file belongs to a different repository, trigger a separate full sync for that repository on first open.
- Full sync operations should only occur once per distinct repository unless manually triggered.
- Plugin should offer manual sync controls for:
    - `Sync Current Repository`
    - `Sync All Known Repositories`
- Server should retain only the latest current state, not historical patch records.
- `User Tree` should be organized by user first, with repository/branch shown underneath.
- `Conflict Tree` should be organized by file first to support reveal-on-open behavior.
- For repositories without upstream configured:
    - show a status warning with an action,
    - let the user choose an upstream branch,
    - present remote branches sorted by the age of the divergence point / last common commit.
- `Working Changes` UI should be organized by file with badges for associated patch states.
- Working-change badges should represent `staged`, `unstaged`, or `upstream`, plus a conflict icon/color.
- For files with both staged and unstaged working changes, start with separate patch records.

## Open clarifying question (ANSWERED)

1. When the user chooses an upstream branch, should Work Share:
    - update Git immediately via `git branch --set-upstream-to`,
    - update only Work Share internal config until the user confirms, or
    - do both with explicit confirmation before changing Git?

    **Answer:** Option B - Store the upstream branch selection in Work Share's internal config only (non-destructive, invisible to git).

    **Note:** This decision should be revisited after completing the initial implementation. We may want to provide a UI option to sync the choice back to Git once users are comfortable with the tool's behavior.

## Recommended implementation model

- Add canonical patch classification fields across shared types / server / plugin:
    - `changeType: "pending" | "working"`
    - `workingState: "staged" | "unstaged"` for working patches
    - `upstreamBranch?: string`
    - `commitSha?: string`
    - `commitShortSha?: string`
    - `commitMessage?: string`
    - `baseCommit?: string`
    - `contentHash` or equivalent dedupe key
- Maintain latest current state only per key similar to:
    - `(repositoryRemoteUrl, upstreamBranch, userName, repositoryFilePath, changeType, workingState?, commitSha?)`
- Use branch-aware filtering by default.
- Simulate rebase conflicts against remote-ahead commits using:
    - remote-ahead aggregate patch / file state,
    - local pending commits in commit order for presentation,
    - aggregate result for conflict prediction,
    - local working changes applied after pending commits.

## Planned UI structure

- `Server Status`
    - connection status
    - sharing toggle
    - last update / last sync
    - user identity
    - current repository
    - current upstream branch
    - no-upstream warning with action
    - sync commands / buttons
- `Conflict Tree`
    - top level: file
    - child nodes: conflict sources / patch items / commit items
    - actions: open diff, merge tooling, reveal related context
    - reveal associated file node when file is opened in editor
- `User Tree`
    - top level: user
    - child nodes: repository / branch
    - child leaves: pending commits and working changes

## Suggested phased implementation plan

1. Shared contract update

- Add patch/activity fields for `changeType`, `workingState`, commit metadata, and dedupe metadata.
- Ensure branch fields remain optional for compatibility during rollout.

2. Server state model rewrite

- Replace append-only patch storage with latest-state buckets.
- Add filtering for `upstreamBranch`, `changeType`, `workingState`, `commitSha` where useful.
- Return user-centric and file-centric projections needed by trees.

3. Plugin repository sync coordinator

- Track which repositories have completed initial full sync.
- Full sync workspace-root repository on initialization.
- Full sync newly encountered repositories on first file open.
- Add manual sync commands for current/all repositories.

4. Pending commit collector

- Determine `upstream..HEAD` commit list.
- Emit one patch per commit.
- Capture commit message and short SHA.
- Sync only latest current pending state to server.

5. Working change collector

- Emit separate working patches for staged and unstaged file changes.
- Trigger on initialization and file save.
- Attach badges / state labels in returned projections.

6. Conflict engine upgrade

- Same-branch only by default.
- Optional show-all toggle.
- Model rebase scenario: remote-ahead base -> local pending aggregate -> local working changes.
- Surface conflict severity/icon state at file level.

7. Tree view redesign

- Separate views for Status / Conflict / User content.
- Add reveal-on-open for conflict tree file nodes.
- Show commit message + short SHA in pending commit nodes.
- Use badges/icons for staged/unstaged/upstream/conflict states.

8. Upstream branch UX

- Detect missing upstream.
- Show warning with action.
- Branch picker sorted by divergence-point recency.
- Final behavior pending answer to open question above.

## Notes about prior code changes already made

- Server was already updated in this session to capture and filter `upstreamBranch`.
- Shared types were updated to include optional `upstreamBranch` on activity/patch/file/repository records.
- Server tests were updated and passing at that point.
- Extension local typings for `vscode.git` were vendored from upstream and pinned to a commit SHA.
- Some git CLI usage in extension was replaced with `vscode.git` API methods where safe.

## Risks / engineering notes

- Rebase simulation is the hardest part. Do not approximate it with only naive diff overlap if accuracy is a goal.
- Separate staged/unstaged patches can produce duplicate file nodes unless aggregation keys are designed carefully.
- Latest-state-only server storage requires explicit replacement semantics for sync operations.
- Branch-aware grouping must be preserved everywhere to avoid mixing unrelated work.

## Suggested next action when resuming

- Start by answering the remaining upstream-selection persistence question.
- Then break implementation into concrete tasks by package:
    - `shared`
    - `server`
    - `extension`
    - optional dashboard alignment
