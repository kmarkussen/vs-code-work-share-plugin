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

**Server (Node.js API)**

- Receives and processes activity data
- Built with Express and routing-controllers
- Validates requests using class-validator
- Provides health check endpoint
- Runs in Docker container

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

## Plugin Features

1. **File Activity Tracking**: The plugin will track which files are being edited and by whom. This information will be displayed in a user-friendly interface within VS Code.

2. **Real-time Updates**: The plugin will provide real-time updates on file activity, allowing team members to see changes as they happen.

3. Variables

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
    - Checks command registration
    - Validates default configuration

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
