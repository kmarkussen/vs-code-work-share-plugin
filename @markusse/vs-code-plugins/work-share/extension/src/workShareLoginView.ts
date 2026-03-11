import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { FileActivityTracker } from "./fileActivityTracker";

/** State payload sent from the extension to the webview on each refresh. */
interface ViewState {
    connectionStatus: "ok" | "warning" | "error";
    connectionMessage: string;
    authRequired: boolean;
    authenticatedUsername: string | undefined;
    currentUsername: string;
    sharingEnabled: boolean;
    repositoryName: string | undefined;
    upstreamBranch: string | undefined;
    remoteConflictIssue: string | undefined;
}

/**
 * WebviewViewProvider for the workShareStatus panel.
 * Replaces the tree-view status panel with an interactive sidebar that shows
 * connection / authentication state and surfaces a login form when needed.
 */
export class WorkShareLoginView implements vscode.WebviewViewProvider {
    public static readonly viewType = "workShareStatus";

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _apiClient: ApiClient,
        private readonly _tracker: FileActivityTracker | undefined,
        /** Called with (token, username) after a successful login so the caller can persist the token. */
        private readonly _onLogin: (token: string, username: string) => Promise<void> | void,
        /** Called after logout so the caller can clear any persisted token. */
        private readonly _onLogout: () => Promise<void> | void,
    ) {}

    /**
     * Called by VS Code when the view becomes visible for the first time or is restored.
     * Sets up the webview HTML, message routing, and change-event subscriptions.
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        void _context;
        void _token;
        this._view = webviewView;

        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Route messages sent from the embedded JS to extension handlers.
        webviewView.webview.onDidReceiveMessage(
            async (message: { command: string; username?: string; password?: string }) => {
                switch (message.command) {
                    case "login":
                        await this._handleLogin(message.username ?? "", message.password ?? "");
                        break;
                    case "logout":
                        await this._handleLogout();
                        break;
                    case "toggleSharing":
                        await vscode.commands.executeCommand("work-share.toggleTracking");
                        break;
                }
            },
        );

        // Push a fresh state snapshot into the webview whenever relevant data changes.
        const refresh = () => void this._pushState();
        this._apiClient.onDidChangeData(refresh);
        this._apiClient.onDidChangeAuthState(refresh);
        if (this._tracker) {
            this._tracker.onDidChangeConflictStatus(refresh);
        }
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("workShare")) {
                refresh();
            }
        });

        // Initial state push.
        void this._pushState();
    }

    /**
     * Forces an immediate state refresh.  Call this after external auth changes
     * (e.g. restoring a persisted token on startup).
     */
    public refresh(): void {
        void this._pushState();
    }

    // -------------------------------------------------------------------------
    // Login / logout
    // -------------------------------------------------------------------------

    private async _handleLogin(username: string, password: string): Promise<void> {
        try {
            const result = await this._apiClient.login(username, password);
            await this._onLogin(result.token, result.username);
            void this._view?.webview.postMessage({ type: "loginResult", success: true });
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : "Login failed. Check your credentials and server URL.";
            void this._view?.webview.postMessage({ type: "loginResult", success: false, error: errorMessage });
        }
    }

    private async _handleLogout(): Promise<void> {
        await this._apiClient.logout();
        await this._onLogout();
        await this._pushState();
    }

    // -------------------------------------------------------------------------
    // State building and push
    // -------------------------------------------------------------------------

    private async _pushState(): Promise<void> {
        if (!this._view) {
            return;
        }
        const state = await this._buildState();
        void this._view.webview.postMessage({ type: "stateUpdate", ...state });
    }

    private async _buildState(): Promise<ViewState> {
        const connectionIssue = this._apiClient.getConnectionIssue();
        const authRequired = this._apiClient.isAuthRequired();
        const authenticatedUsername = this._apiClient.getAuthenticatedUsername();

        const currentUsername = this._tracker ? await this._tracker.getCurrentUserName() : "Unknown user";
        const sharingEnabled = vscode.workspace.getConfiguration("workShare").get<boolean>("enabled", true);

        // Only show repository info when authentication is not otherwise blocking things.
        const repositoryRemoteUrl = this._tracker ? await this._tracker.getCurrentRepositoryRemoteUrl() : undefined;
        const repositoryName = repositoryRemoteUrl ? _parseRepoName(repositoryRemoteUrl) : undefined;
        const upstreamBranch = this._tracker ?
            await this._tracker.getUpstreamBranchForCurrentRepository()
        :   undefined;

        // When auth is required the connection itself is fine — show "ok" and let the auth
        // banner communicate what the user needs to do.
        const connectionStatus =
            authRequired ? "ok"
            : connectionIssue ? (connectionIssue.level as "warning" | "error")
            : "ok";
        const connectionMessage =
            authRequired ? "Connected to Work Share API."
            : (connectionIssue?.message ?? "Connected to Work Share API.");

        return {
            connectionStatus,
            connectionMessage,
            authRequired,
            authenticatedUsername,
            currentUsername,
            sharingEnabled,
            repositoryName,
            upstreamBranch,
            remoteConflictIssue: undefined,
        };
    }

    // -------------------------------------------------------------------------
    // HTML template
    // -------------------------------------------------------------------------

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = _getNonce();
        // Unused parameter kept for future local resource loading.
        void webview;
        void this._extensionUri;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        *, *::before, *::after { box-sizing: border-box; }

        body {
            padding: 8px 10px;
            font-size: var(--vscode-font-size, 13px);
            font-family: var(--vscode-font-family, sans-serif);
            color: var(--vscode-foreground);
            background: transparent;
            margin: 0;
        }

        /* ── Connection row ─────────────────────────────────── */
        .status-row {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 2px 0;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .status-row.ok    { color: var(--vscode-testing-iconPassed, #73C991); }
        .status-row.warn  { color: var(--vscode-list-warningForeground, #CCA700); }
        .status-row.error { color: var(--vscode-errorForeground, #F48771); }

        /* ── Auth banner ────────────────────────────────────── */
        .auth-banner {
            display: none;
            background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,.1));
            border: 1px solid var(--vscode-inputValidation-warningBorder, #CCA700);
            border-radius: 3px;
            padding: 8px;
            margin: 6px 0;
        }
        .auth-banner.visible { display: block; }

        .auth-title {
            font-weight: 600;
            font-size: 12px;
            margin-bottom: 8px;
        }

        .form-label {
            display: block;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 2px;
        }
        .form-group { margin-bottom: 6px; }

        input[type="text"],
        input[type="password"] {
            width: 100%;
            padding: 4px 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 3px;
            outline: none;
            font-size: 12px;
            font-family: inherit;
        }
        input:focus { border-color: var(--vscode-focusBorder); }

        .btn {
            display: block;
            width: 100%;
            padding: 5px 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            font-family: inherit;
            margin-top: 6px;
        }
        .btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .login-error {
            color: var(--vscode-errorForeground, #F48771);
            font-size: 11px;
            margin-top: 4px;
            display: none;
        }
        .login-error.visible { display: block; }

        /* ── Divider ────────────────────────────────────────── */
        .divider {
            height: 1px;
            background: var(--vscode-panel-border, var(--vscode-editorWidget-border, #444));
            margin: 7px 0;
        }

        /* ── Authenticated user block ───────────────────────── */
        .user-info { display: none; }
        .user-info.visible { display: block; }

        .user-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            padding: 2px 0;
        }
        .user-name { font-size: 12px; font-weight: 600; }

        .link-btn {
            background: none;
            border: none;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            font-size: 11px;
            padding: 1px 0;
            text-decoration: underline;
            font-family: inherit;
        }
        .link-btn:hover { color: var(--vscode-textLink-activeForeground); }

        /* ── Anonymous identity hint ────────────────────────── */
        .identity-row { display: none; }

        /* ── Sharing toggle ─────────────────────────────────── */
        .sharing-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 2px 0;
        }
        .sharing-label { font-size: 12px; cursor: pointer; }

        /* ── Repository section ─────────────────────────────── */
        .repo-section { display: none; }
    </style>
</head>
<body>

    <!-- Connection status -->
    <div id="connectionRow" class="status-row ok">
        <span id="connectionIcon">&#9679;</span>
        <span id="connectionText">Connecting&hellip;</span>
    </div>

    <!-- Authentication required — login form -->
    <div id="authBanner" class="auth-banner">
        <div class="auth-title">&#128272; Sign in to Work Share</div>
        <div class="form-group">
            <label class="form-label" for="usernameInput">Username</label>
            <input type="text" id="usernameInput" placeholder="Enter username" autocomplete="username" />
        </div>
        <div class="form-group">
            <label class="form-label" for="passwordInput">Password</label>
            <input type="password" id="passwordInput" placeholder="Enter password" autocomplete="current-password" />
        </div>
        <div id="loginError" class="login-error"></div>
        <button id="loginBtn" class="btn">Sign In</button>
    </div>

    <div class="divider"></div>

    <!-- Authenticated user info (shown when signed in) -->
    <div id="userInfo" class="user-info">
        <div class="status-row ok">
            <span>&#128100; Signed in as</span>
        </div>
        <div class="user-row">
            <span id="authenticatedUser" class="user-name"></span>
            <button id="logoutBtn" class="link-btn">Sign out</button>
        </div>
    </div>

    <!-- Anonymous identity hint (shown when not signed in and no auth required) -->
    <div id="identityRow" class="status-row identity-row">
        <span>&#128100;</span>
        <span id="identityText"></span>
    </div>

    <div class="divider"></div>

    <!-- Sharing toggle -->
    <div class="sharing-row">
        <input type="checkbox" id="sharingToggle" />
        <label for="sharingToggle" class="sharing-label">Share file activity</label>
    </div>

    <!-- Repository / upstream info -->
    <div id="repoSection" class="repo-section">
        <div class="divider"></div>
        <div class="status-row">
            <span>&#128193;</span>
            <span id="repoText"></span>
        </div>
        <div id="upstreamRow" class="status-row" style="display:none">
            <span>&#127807;</span>
            <span id="upstreamText"></span>
        </div>
        <div id="noUpstreamRow" class="status-row warn" style="display:none">
            <span>&#9888;</span>
            <span>No upstream branch configured</span>
        </div>
    </div>

    <!-- Remote conflict issue (rare; shown underneath repo block) -->
    <div id="conflictRow" class="status-row warn" style="display:none">
        <span>&#9888;</span>
        <span id="conflictText"></span>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        // ── Message handler ────────────────────────────────────────────
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.type === 'stateUpdate') {
                applyState(msg);
            } else if (msg.type === 'loginResult') {
                handleLoginResult(msg);
            }
        });

        // ── State renderer ─────────────────────────────────────────────
        function applyState(state) {
            // Connection row
            const connRow  = document.getElementById('connectionRow');
            const connIcon = document.getElementById('connectionIcon');
            const connText = document.getElementById('connectionText');
            if (state.connectionStatus === 'ok') {
                connRow.className  = 'status-row ok';
                connIcon.innerHTML = '&#9679;';
                connText.textContent = 'Connected';
            } else if (state.connectionStatus === 'warning') {
                connRow.className  = 'status-row warn';
                connIcon.innerHTML = '&#9888;';
                connText.textContent = state.connectionMessage || 'Connection warning';
            } else {
                connRow.className  = 'status-row error';
                connIcon.innerHTML = '&#10007;';
                connText.textContent = state.connectionMessage || 'Connection error';
            }

            // Auth banner / user info
            const authBanner   = document.getElementById('authBanner');
            const userInfo     = document.getElementById('userInfo');
            const identityRow  = document.getElementById('identityRow');

            if (state.authRequired) {
                authBanner.classList.add('visible');
                userInfo.classList.remove('visible');
                identityRow.style.display = 'none';
            } else if (state.authenticatedUsername) {
                authBanner.classList.remove('visible');
                userInfo.classList.add('visible');
                identityRow.style.display = 'none';
                document.getElementById('authenticatedUser').textContent = state.authenticatedUsername;
            } else {
                authBanner.classList.remove('visible');
                userInfo.classList.remove('visible');
                identityRow.style.display = 'flex';
                document.getElementById('identityText').textContent = state.currentUsername || 'Unknown user';
            }

            // Sharing toggle
            document.getElementById('sharingToggle').checked = !!state.sharingEnabled;

            // Repository section
            const repoSection = document.getElementById('repoSection');
            if (state.repositoryName) {
                repoSection.style.display = 'block';
                document.getElementById('repoText').textContent = state.repositoryName;
                if (state.upstreamBranch) {
                    document.getElementById('upstreamRow').style.display   = 'flex';
                    document.getElementById('noUpstreamRow').style.display = 'none';
                    document.getElementById('upstreamText').textContent = state.upstreamBranch;
                } else {
                    document.getElementById('upstreamRow').style.display   = 'none';
                    document.getElementById('noUpstreamRow').style.display = 'flex';
                }
            } else {
                repoSection.style.display = 'none';
            }

            // Conflict issue
            const conflictRow = document.getElementById('conflictRow');
            if (state.remoteConflictIssue) {
                conflictRow.style.display = 'flex';
                document.getElementById('conflictText').textContent = state.remoteConflictIssue;
            } else {
                conflictRow.style.display = 'none';
            }
        }

        // ── Login result handler ───────────────────────────────────────
        function handleLoginResult(msg) {
            const btn = document.getElementById('loginBtn');
            btn.textContent = 'Sign In';
            btn.disabled = false;
            if (!msg.success) {
                const errorEl = document.getElementById('loginError');
                errorEl.textContent = msg.error || 'Login failed.';
                errorEl.classList.add('visible');
            } else {
                document.getElementById('usernameInput').value = '';
                document.getElementById('passwordInput').value = '';
                document.getElementById('loginError').classList.remove('visible');
            }
        }

        // ── Login form ─────────────────────────────────────────────────
        document.getElementById('loginBtn').addEventListener('click', () => {
            const username = document.getElementById('usernameInput').value.trim();
            const password = document.getElementById('passwordInput').value;
            const errorEl  = document.getElementById('loginError');

            if (!username || !password) {
                errorEl.textContent = 'Username and password are required.';
                errorEl.classList.add('visible');
                return;
            }
            errorEl.classList.remove('visible');

            const btn = document.getElementById('loginBtn');
            btn.textContent = 'Signing in\u2026';
            btn.disabled = true;

            vscode.postMessage({ command: 'login', username, password });
        });

        // Allow Enter key to advance through the form fields.
        document.getElementById('usernameInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') document.getElementById('passwordInput').focus();
        });
        document.getElementById('passwordInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') document.getElementById('loginBtn').click();
        });

        // ── Logout button ──────────────────────────────────────────────
        document.getElementById('logoutBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'logout' });
        });

        // ── Sharing toggle ─────────────────────────────────────────────
        document.getElementById('sharingToggle').addEventListener('change', () => {
            vscode.postMessage({ command: 'toggleSharing' });
        });
    </script>
</body>
</html>`;
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts a human-readable repository name from a remote URL.
 * e.g. "https://github.com/org/repo.git" → "repo"
 */
function _parseRepoName(remoteUrl: string): string {
    const last = remoteUrl.split("/").pop() ?? remoteUrl;
    return last.replace(/\.git$/i, "") || remoteUrl;
}

/** Generates a cryptographically-adequate random nonce for use in CSP headers. */
function _getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
