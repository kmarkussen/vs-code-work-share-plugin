## Project Overview

This project focuses on building a VS Code plugin that provides visibility to teams
on which project files are being worked on and by whom. The plugin will allow users to see who is working on which files, enabling better collaboration and coordination within teams.

The plugin will track file activity for all git patches and will report this information to an external system for distributing project work information. This will help teams manage their workload more effectively and ensure that everyone is aware of the current state of the project.

## Project Structure

The project is organized into two main components:

```
work-share/
├── plugin/                 # VS Code Extension
│   ├── src/               # TypeScript source files
│   ├── resources/         # Extension assets
│   ├── package.json       # Extension manifest
│   └── tsconfig.json      # TypeScript config
├── server/                # Node.js API Server
│   ├── client/            # React Dashboard
│   │   ├── src/          # React components and logic
│   │   │   ├── components/ # RepositoriesPanel, UsersPanel, PatchesPanel
│   │   │   ├── App.tsx   # Main app with MUI theme and tabs
│   │   │   ├── api.ts    # HTTP client for server API
│   │   │   └── types.ts  # TypeScript interfaces
│   │   ├── index.html    # Dashboard entry point
│   │   ├── vite.config.ts # Build configuration
│   │   └── package.json  # Dashboard dependencies
│   ├── public/            # Built dashboard files (generated)
│   ├── src/               # Server source files
│   │   ├── app.ts        # Main application entry
│   │   ├── controllers/  # Request handlers
│   │   └── dtos/         # Data transfer objects
│   ├── Dockerfile        # Docker image definition
│   ├── package.json      # Server dependencies
│   └── tsconfig.json     # TypeScript config
├── .vscode/               # VS Code workspace configuration
│   ├── launch.json        # Debug configurations
│   ├── tasks.json         # Build tasks
│   └── extensions.json    # Recommended extensions
├── docker-compose.yml    # Docker orchestration
├── package.json          # Root-level scripts
└── agents.md            # This documentation
```

### Components

**Plugin (VS Code Extension)**

- Tracks file activity (open, edit, close events)
- Identifies users via git config or settings
- Sends activity data to the server API
- Displays activity in sidebar tree view
- Shows conflict detection warnings

**Server (Node.js API)**

- Receives and processes activity data and patches
- Built with Express and routing-controllers
- Validates requests using class-validator
- Provides health check endpoint
- Runs in Docker container
- Serves React dashboard at root URL

**Dashboard (React Web UI)**

- Material-UI themed single-page application
- Three-tab interface: Repositories, Users, Patches
- Real-time monitoring with auto-refresh (5-second interval)
- Repository view: Activity counts, patch counts, active users
- User view: Recent activity, last seen timestamps, repositories
- Patch view: Expandable cards with syntax-highlighted diffs
- Built with Vite and served as static files from server

## AI Agent Quick Reference

This section provides quick guidance for AI agents to efficiently navigate the project and perform common validation tasks.

### Project Paths

**Workspace Root:** `/home/markusse/projects/vs-code-plugins/work-share`

**Key Directories:**

- Plugin source: `/home/markusse/projects/vs-code-plugins/work-share/plugin/src/`
- Plugin compiled output: `/home/markusse/projects/vs-code-plugins/work-share/plugin/out/`
- Server source: `/home/markusse/projects/vs-code-plugins/work-share/server/src/`
- Dashboard source: `/home/markusse/projects/vs-code-plugins/work-share/server/client/src/`

### Working Directory Guidelines

**Always use absolute paths** when changing directories in terminal commands, especially when the current working directory is uncertain:

```bash
# Correct - Use absolute paths
cd /home/markusse/projects/vs-code-plugins/work-share/plugin && npm test

# May fail - Relative paths depend on current directory
cd plugin && npm test
```

**From workspace root**, relative paths work:

```bash
cd plugin && npm run compile
cd server && npm run dev
```

### Quick Validation Workflow

After making changes to **plugin** code, run these commands in sequence:

```bash
# 1. Compile TypeScript (must succeed before proceeding)
cd /home/markusse/projects/vs-code-plugins/work-share/plugin && npm run compile

# 2. Run linter (warnings are okay, errors must be fixed)
cd /home/markusse/projects/vs-code-plugins/work-share/plugin && npm run lint

# 3. Run tests (all must pass)
cd /home/markusse/projects/vs-code-plugins/work-share/plugin && npm test
```

After making changes to **server** code:

```bash
# 1. Compile TypeScript
cd /home/markusse/projects/vs-code-plugins/work-share/server && npm run compile

# 2. Run linter
cd /home/markusse/projects/vs-code-plugins/work-share/server && npm run lint
```

### Common Commands by Component

**Plugin Commands** (run from `/home/markusse/projects/vs-code-plugins/work-share/plugin/`):

```bash
npm run compile          # Compile TypeScript to out/ directory
npm run watch            # Compile in watch mode (auto-recompile)
npm run lint             # Run ESLint checks
npm test                 # Run all tests (includes compile + lint)
```

**Server Commands** (run from `/home/markusse/projects/vs-code-plugins/work-share/server/`):

```bash
npm run compile          # Compile TypeScript
npm run dev              # Start development server with hot-reload
npm run lint             # Run ESLint checks
```

**Dashboard Commands** (run from `/home/markusse/projects/vs-code-plugins/work-share/server/client/`):

```bash
npm run dev              # Start Vite dev server on port 5173
npm run build            # Build for production to ../public/
```

**Root Commands** (run from `/home/markusse/projects/vs-code-plugins/work-share/`):

```bash
npm run build            # Build both plugin and server
npm test                 # Run plugin tests
npm run lint             # Lint both components
npm start                # Start server in Docker
npm stop                 # Stop Docker containers
```

### File Editing Best Practices

When modifying code files:

1. **Read enough context**: Include surrounding code to understand the full scope
2. **Verify compilation**: Always compile after edits to catch TypeScript errors
3. **Update tests**: If adding new commands or features, update test files in `plugin/src/test/suite/`
4. **Check for errors**: Use `get_errors` tool to check for TypeScript/lint issues

### Testing Shortcuts

**Quick test check** (without full test run):

```bash
cd /home/markusse/projects/vs-code-plugins/work-share/plugin && npm run compile && npm run lint
```

**Run specific test file** (after navigating to plugin directory):

```bash
npm test -- --grep "Extension Test Suite"
```

**Check test file registration**:
All test files in `plugin/src/test/suite/*.test.ts` are automatically discovered, no manual registration needed.

### Common Issues and Solutions

**Issue:** `cd plugin` fails with "No such file or directory"
**Solution:** Use absolute path or ensure current directory is workspace root

**Issue:** TypeScript compilation errors after editing
**Solution:** Run `npm run compile` from plugin or server directory to see detailed errors

**Issue:** Tests fail with module import errors
**Solution:** Ensure `npm install` has been run in the plugin directory

**Issue:** Changes not reflected in Extension Development Host
**Solution:** Stop debugging (Shift+F5), run `npm run compile` in plugin directory, then restart (F5)

## Root-Level Scripts

The project includes a root-level `package.json` with convenient scripts for working with both components:

### Quick Try Scripts

```bash
npm run try              # Build plugin, start server, and open VS Code
npm run try:stop         # Stop the server after trying
```

This is the fastest way to test the entire application. The `try` command will:

1. Build the plugin TypeScript code
2. Start the server in Docker (detached mode)
3. Open VS Code in the workspace

After running `npm run try`, press **F5** in VS Code to launch the Extension Development Host.

### Installation Scripts

```bash
npm run install:all      # Install dependencies for both plugin and server
npm run install:plugin   # Install plugin dependencies only
npm run install:server   # Install server dependencies only
```

### Build Scripts

```bash
npm run build            # Build both plugin and server
npm run build:plugin     # Compile plugin TypeScript
npm run build:server     # Compile server TypeScript
```

### Development Scripts

```bash
npm run dev:plugin       # Start plugin compilation in watch mode
npm run dev:server       # Start server with hot-reload
```

### Test & Lint Scripts

```bash
npm test                 # Run all tests (plugin tests)
npm run test:plugin      # Run plugin tests explicitly
npm run lint             # Lint both plugin and server
npm run lint:plugin      # Lint plugin code
npm run lint:server      # Lint server code
```

### Docker Scripts

```bash
npm start                # Start server in detached mode
npm stop                 # Stop Docker containers
npm run docker:up        # Start Docker containers (attached)
npm run docker:down      # Stop Docker containers
npm run docker:build     # Build Docker image
npm run docker:logs      # View server logs
npm run docker:restart   # Restart Docker containers
```

### Cleanup Scripts

```bash
npm run clean            # Remove build artifacts and node_modules from both
npm run clean:plugin     # Clean plugin directory
npm run clean:server     # Clean server directory
```

### Packaging Scripts

Package the VS Code extension into a distributable VSIX file:

```bash
npm run package              # Create production-ready VSIX file
npm run package:prerelease   # Create pre-release VSIX file (for beta testing)
```

The packaging script (`scripts/package-extension.sh`) performs the following:

1. **Compiles TypeScript**: Builds the plugin source code
2. **Creates VSIX file**: Uses `@vscode/vsce` to package the extension
3. **Displays instructions**: Shows how to install, share, or publish the extension

**Requirements:**

- Node.js 20+ recommended (vsce compatibility)
- All dependencies installed (`npm install`)

**Output:**

- Location: `plugin/work-share-<version>.vsix`
- The VSIX file can be:
    - Installed locally via VS Code Extensions menu → "..." → "Install from VSIX..."
    - Shared with team members for testing
    - Published to VS Code Marketplace (requires publisher account)

**Documentation:**

- [VS Code Extension Publishing Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VSCE CLI Documentation](https://github.com/microsoft/vscode-vsce)
- [Creating VS Code Extensions](https://code.visualstudio.com/api/get-started/your-first-extension)

**Troubleshooting:**

- If you encounter Node version errors, upgrade to Node.js 20+:
    - Direct download: https://nodejs.org/
    - Or use nvm: `nvm install 20 && nvm use 20`

## Running the Application

### Quick Start with Docker

The easiest way to run the server is using Docker Compose:

```bash
# From project root
npm start
# or
docker-compose up
```

The server will be available at `http://localhost:3000`

To run in detached mode:

```bash
npm start
# or
docker-compose up -d
```

To stop the server:

```bash
npm stop
# or
docker-compose down
```

To rebuild after code changes:

```bash
npm run docker:up -- --build
# or
docker-compose up --build
```

### Running Server in Development Mode

For active development on the server:

```bash
npm run dev:server
# or
cd server
npm install
npm run dev
```

This starts the server with hot-reload enabled (automatically restarts on code changes).

### Docker Commands Reference

**Build the server image:**

```bash
npm run docker:build
# or
docker-compose build
```

**View server logs:**

```bash
npm run docker:logs
# or
docker-compose logs -f work-share-server
```

**Check server health:**

```bash
curl http://localhost:3000/health
```

**Stop and remove containers:**

```bash
docker-compose down
```

**Stop, remove containers, and volumes:**

```bash
docker-compose down -v
```

### VS Code Debugging

The root workspace includes VS Code debug configurations that work from the root level:

**Available Debug Configurations:**

- **Run Extension** - Launches the Extension Development Host with the plugin loaded
- **Extension Tests** - Runs the test suite in the Extension Development Host

**To debug the extension:**

1. Open the workspace root in VS Code (this happens automatically with `npm run try`)
2. Press **F5** to start debugging (uses "Run Extension" by default)
3. Or press **Ctrl+Shift+D** to open the Run and Debug view and select a configuration

The launch configuration automatically:

- Compiles the TypeScript code before launching
- Points to the correct plugin directory
- Sets up source maps for debugging

### Plugin Development

After starting the server, develop the plugin:

```bash
npm run dev:plugin
# or
cd plugin
npm install
npm run watch  # For automatic recompilation
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Configuring the Plugin

1. Open VS Code settings (Ctrl+,)
2. Search for "Work Share"
3. Set `workShare.apiServerUrl` to `http://localhost:3000`
4. Optionally set `workShare.userName` (defaults to git config)

### Testing the Integration

1. Start the server: `npm start` or `docker-compose up`
2. Launch the plugin (F5 in VS Code)
3. Open/edit files in the Extension Development Host
4. Check server logs: `npm run docker:logs` or `docker-compose logs -f`
5. You should see activity messages logged by the server

## Server API Documentation

### Endpoints

**POST /activities**

- Receives file activity data from the plugin
- Request body: `{ activities: ActivityDto[] }`
- Response: `{ success: boolean, message: string, timestamp: string }`

**GET /activities**

- Returns tracked activities from server memory
- Optional query params:
    - `repositoryRemoteUrl`: Filter by repository remote URL
    - `userName`: Filter by user name
- Response: `{ count: number, activities: StoredActivity[] }`

**POST /patches**

- Receives repository-relative unified diff patches shared on save
- Request body: `PatchDto`
- Response: `{ success: boolean, message: string, timestamp: string }`

**GET /patches**

- Returns shared patches from server memory
- Optional query params:
    - `repositoryRemoteUrl`: Filter by repository remote URL
    - `repositoryFilePath`: Filter by repository-relative file path
    - `userName`: Filter by user name
- Response: `{ count: number, patches: StoredPatch[] }`

**GET /health**

- Health check endpoint
- Response: `{ status: string, timestamp: string }`

### Activity Data Format

```typescript
{
  "activities": [
    {
      "filePath": "/path/to/file.ts",
      "userName": "John Doe",
      "timestamp": "2026-03-07T10:30:00.000Z",
            "action": "open" | "edit" | "close",
            "repositoryRemoteUrl": "https://github.com/org/repo.git"
    }
  ]
}
```

## Dashboard

The server includes a web-based React dashboard for real-time monitoring of file activity and code patches across the team.

### Accessing the Dashboard

When the server is running, open `http://localhost:3000` in a web browser to access the dashboard.

### Dashboard Architecture

The dashboard is built as a single-page application (SPA) using:

- **React 18.2**: UI framework
- **Material-UI (MUI) 5.14**: Component library with dark theme
- **Vite 5.0**: Build tool and dev server
- **Axios 1.6**: HTTP client for API communication

The dashboard source code is located in `server/client/` and builds to `server/public/`, which is served as static files by the Express server.

### Dashboard Features

**Three-Tab Interface**

1. **Repositories Tab**
    - Displays all tracked repositories from git remote URLs
    - Shows activity count and patch count per repository
    - Lists active users for each repository (top 5 displayed)
    - Responsive card grid layout with folder icons

2. **Users Tab**
    - Shows all team members who have submitted activity or patches
    - Displays last activity timestamp with relative time formatting ("5m ago", "2h ago")
    - Lists repositories each user is working on
    - Avatar icons for visual identification

3. **Patches Tab**
    - Shows all shared code patches in expandable cards
    - Syntax-highlighted diff viewer in monospace font
    - Metadata chips display: username, repository, timestamp, base commit
    - Collapsible content to save screen space

**Auto-Refresh**

The dashboard automatically fetches fresh data from the server every 5 seconds, providing near real-time visibility into team activity.

### Dashboard Development

**Installing Dependencies**

```bash
cd server/client
npm install
```

**Development Mode**

Run the Vite dev server with hot module replacement:

```bash
cd server/client
npm run dev
```

The dev server runs on port 5173 with proxy configuration for API routes (`/activities`, `/patches`, `/health`).

**Building for Production**

```bash
cd server/client
npm run build
```

This compiles the React app to `server/public/` for serving by the Express server.

**Dashboard Components**

- `App.tsx`: Main application with MUI ThemeProvider, tab navigation, and data loading
- `components/RepositoriesPanel.tsx`: Repository aggregation and display
- `components/UsersPanel.tsx`: User activity summary and display
- `components/PatchesPanel.tsx`: Patch cards with expandable diff viewer
- `api.ts`: Axios client for fetching activities and patches
- `types.ts`: TypeScript interfaces for Activity, Patch, Repository, UserData

## Plugin Features

1. **File Activity Tracking**: The plugin will track which files are being edited and by whom. This information will be displayed in a user-friendly interface within VS Code.

2. **Real-time Updates**: The plugin will provide real-time updates on file activity, allowing team members to see changes as they happen.

3. **Toggle Tracking Button**: A UI toggle button in the Work Share sidebar allows users to enable/disable tracking with a single click. The button shows an eye icon (enabled) or eye-closed icon (disabled) and updates the `workShare.enabled` configuration setting.

4. **Auto-Reveal in Tree View**: When you navigate to a file in the editor, the Work Share tree view automatically expands and highlights the corresponding file node. This helps you quickly see who else is working on the same file and view related activity.

5. **Conflict Detection**: The plugin can check for potential merge conflicts by comparing local changes against incoming patches from other team members.

### Registered Commands

The plugin registers the following commands that can be invoked via the command palette or UI:

- **`work-share.showFileActivity`**: Opens the file activity view and refreshes the display
- **`work-share.configure`**: Opens VS Code settings focused on Work Share configuration
- **`work-share.toggleTracking`**: Toggles the `workShare.enabled` setting on/off and provides user feedback
- **`work-share.checkActiveFileConflicts`**: Checks the currently active file for potential merge conflicts from incoming patches
- **`work-share.checkProjectConflicts`**: Scans all tracked files in the project for potential merge conflicts

**Note:** When adding new commands, ensure they are:

1. Registered in `plugin/package.json` under `contributes.commands`
2. Implemented in `plugin/src/extension.ts` with `vscode.commands.registerCommand`
3. Added to tests in `plugin/src/test/suite/extension.test.ts`

### Configuration Variables

- **User Identification**: The plugin will identify users based on their VS Code profiles or through integration with a team collaboration tool (e.g., Slack, Microsoft Teams).
- **API Servers URL**: The plugin will support modifying the server URL for reporting file activity.

## Coding Standards and Best Practices

- **TypeScript**: The plugin will be developed using TypeScript to ensure type safety and maintainability.
- **Modular Architecture**: The codebase will be organized into modules to promote separation of concerns and improve readability.
- **Error Handling**: Proper error handling will be implemented to ensure thatthe plugin can gracefully handle unexpected situations without crashing.
- **Testing**: Unit tests will be written to ensure the reliability of the plugin and to catch potential issues early in the development process.
- **Documentation**: The code will be well-documented to facilitate understanding and maintenance by other developers.

### Inline Documentation Standards

When generating or modifying code, use the following documentation rules:

1. **Public API documentation is required**
    - Add JSDoc/TSDoc comments to all exported classes, interfaces, and public methods.
    - Include purpose, important parameters, and return values.

2. **Explain non-obvious behavior**
    - Add short inline comments for logic that is not self-evident (e.g., repository resolution, deduping rules, fallback logic).
    - Do not add comments that simply restate obvious code.

3. **Document data contracts**
    - For DTOs and API payload interfaces, document fields that are critical for integration (especially identifiers and filters like `repositoryRemoteUrl`).

4. **Comment asynchronous flows and side effects**
    - Add comments around background timers, event subscriptions, server calls, and state mutation boundaries.

5. **Keep documentation current**
    - When behavior changes, update nearby comments and any related README/agents API examples in the same change.

6. **Style requirements**
    - Use concise, action-oriented comments.
    - Prefer sentence case and end comments with punctuation.
    - Keep comments close to the logic they describe.

## Testing

This project uses **Mocha** as the testing framework with **@vscode/test-electron** for VS Code extension integration testing. This is the recommended and most appropriate testing approach for VS Code extensions as it provides full access to the VS Code Extension API during tests.

### Testing Framework

- **Test Runner**: Mocha (TDD style)
- **Integration**: @vscode/test-electron
- **Test Location**: `plugin/src/test/suite/`
- **Coverage**: Extension activation, commands, configuration, API client, and file activity tracking

### Running Tests

#### Run All Tests

```bash
cd plugin
npm test
```

This command will:

1. Compile TypeScript sources
2. Run ESLint
3. Download a VS Code instance (if needed)
4. Execute all test suites in the Extension Host

**Note:** On Linux, ensure required system libraries are installed:

```bash
sudo apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
```

#### Run Tests from VS Code

1. Open the **Run and Debug** view (Ctrl+Shift+D / Cmd+Shift+D)
2. Select **"Extension Tests"** from the dropdown
3. Press **F5** or click the green play button

#### Watch Mode for Development

```bash
cd plugin
npm run watch
```

Run this in a terminal to automatically recompile on file changes, then run tests separately.

### Test Structure

Tests are organized in the `plugin/src/test/` directory:

```
plugin/src/test/
├── runTest.ts                          # Test runner entry point
└── suite/
    ├── index.ts                        # Test suite loader
    ├── extension.test.ts               # Extension activation tests
    ├── apiClient.test.ts               # API client tests
    └── fileActivityTracker.test.ts     # File tracking tests
```

### Writing Tests

Tests use Mocha's TDD interface with the following structure:

```typescript
import * as assert from "assert";
import * as vscode from "vscode";

suite("My Test Suite", () => {
    // Setup before each test
    setup(() => {
        // Initialize test fixtures
    });

    // Cleanup after each test
    teardown(() => {
        // Clean up resources
    });

    test("Should do something", () => {
        assert.strictEqual(1 + 1, 2);
    });

    test("Should work with VS Code API", async () => {
        const commands = await vscode.commands.getCommands();
        assert.ok(commands.length > 0);
    });
});
```

### Test Coverage Areas

1. **Extension Activation** (`extension.test.ts`)
    - Verifies extension loads correctly
    - Checks command registration (including `toggleTracking`, `checkActiveFileConflicts`, `checkProjectConflicts`)
    - Validates default configuration
    - Tests toggle tracking command behavior

2. **API Client** (`apiClient.test.ts`)
    - Tests API initialization
    - Validates error handling
    - Checks configuration updates

3. **File Activity Tracker** (`fileActivityTracker.test.ts`)
    - Tests tracker initialization
    - Validates start/stop behavior
    - Checks activity collection

### Adding New Tests

1. Create a new file in `plugin/src/test/suite/` with the pattern `*.test.ts`
2. Import required modules:
    ```typescript
    import * as assert from "assert";
    import * as vscode from "vscode";
    ```
3. Write your test suite using `suite()` and `test()` functions
4. Run `npm test` to verify

### Debugging Tests

1. Set breakpoints in your test files
2. Open **Run and Debug** view
3. Select **"Extension Tests"**
4. Press **F5** to start debugging
5. Execution will pause at breakpoints

### Continuous Integration

For CI/CD pipelines, use headless mode:

```bash
# Install dependencies
cd plugin
npm install

# Run tests in headless mode
xvfb-run -a npm test
```

Or use the VS Code Test CLI with appropriate display settings.

### Best Practices

- **Isolate tests**: Each test should be independent
- **Use setup/teardown**: Initialize and cleanup resources properly
- **Mock external dependencies**: Don't make real API calls in tests
- **Test commands**: Verify all registered commands work correctly
- **Test configuration**: Ensure settings are read and applied correctly
- **Async handling**: Use `async/await` for asynchronous operations

### Troubleshooting

**Tests failing to start:**

- Ensure VS Code is not already running the Extension Development Host
- Check that `out/` directory exists with compiled code
- Run `npm run compile` manually

**Timeout errors:**

- Increase timeout in test suite: `this.timeout(10000);`
- Check for unresolved promises

**Import errors:**

- Verify all dependencies are installed: `npm install`
- Check TypeScript compilation: `npm run compile`

### Alternative Testing Approaches

While Mocha is the standard for VS Code extensions, you could consider:

- **Jest**: Requires additional setup and mocking of VS Code API
- **Vitest**: Modern alternative but lacks native VS Code Extension API support

The current Mocha + @vscode/test-electron setup is recommended as it provides seamless integration with VS Code's Extension API and is officially supported by the VS Code team.
