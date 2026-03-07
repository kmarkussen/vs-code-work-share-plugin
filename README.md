# Work Share

A collaborative VS Code extension with a remote server for tracking and sharing file activity across team members.

## Project Structure

```
work-share/
├── plugin/          # VS Code extension
├── server/          # Node.js API server
├── docker-compose.yml
└── agents.md        # Project documentation
```

## Quick Start

### Try It Out (One Command)

The fastest way to try the application:

```bash
npm run try
```

This will:

1. Build the plugin
2. Start the server in Docker
3. Open VS Code in the workspace

Then **press F5** to launch the Extension Development Host (or use Ctrl+Shift+D to select a debug configuration).

When you're done:

```bash
npm run try:stop
```

### Install Dependencies

```bash
npm run install:all
```

Or install individually:

```bash
npm run install:plugin
npm run install:server
```

### Running the Server

**Using Docker (recommended):**

```bash
npm start
# or
npm run docker:up
```

**Development mode (with hot-reload):**

```bash
npm run dev:server
```

The server will be available at `http://localhost:3000`

### Developing the Plugin

```bash
npm run dev:plugin
```

Press F5 in VS Code to launch the Extension Development Host.

### Building

**Build everything:**

```bash
npm run build
```

**Build individually:**

```bash
npm run build:plugin  # Compiles TypeScript for plugin
npm run build:server  # Compiles TypeScript for server
```

### Running Tests

```bash
npm test
```

### Other Useful Commands

```bash
npm run lint              # Lint both plugin and server
npm run clean             # Remove build artifacts and node_modules
npm run docker:logs       # View server logs
npm run docker:restart    # Restart Docker containers
npm stop                  # Stop Docker containers
```

## Configuration

Configure the plugin to connect to the server:

1. Open VS Code settings
2. Search for "Work Share"
3. Set `workShare.apiServerUrl` to `http://localhost:3000`

## More Information

See [agents.md](agents.md) for detailed development documentation.
