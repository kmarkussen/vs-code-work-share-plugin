# Work Share

A collaborative VS Code extension with a remote server for tracking and sharing file activity across team members in real-time.

## Features

- 📊 **Real-time Activity Tracking**: Monitor who's working on which files across your team
- 🔄 **Patch Sharing**: Automatically share code changes when saving files
- ⚠️ **Conflict Detection**: Get warnings about potential merge conflicts before they happen
- 👁️ **Toggle Tracking**: Enable/disable tracking with a single click
- � **Auto-Reveal in Tree**: Tree view automatically expands to show the active file
- �🌐 **Web Dashboard**: View team activity and code patches in a modern web interface
- 🐳 **Docker Ready**: Simple deployment with Docker Compose

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Development](#development)
- [Building](#building)
- [Packaging](#packaging)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Contributing](#contributing)

## Architecture

```
work-share/
├── plugin/                 # VS Code Extension (TypeScript)
│   ├── src/               # Extension source code
│   ├── out/               # Compiled JavaScript (generated)
│   └── package.json       # Extension manifest
├── server/                # Node.js API Server (Express)
│   ├── src/               # Server source code
│   ├── client/            # React Dashboard (Vite)
│   ├── public/            # Built dashboard (generated)
│   └── Dockerfile         # Server container image
├── scripts/               # Build and deployment scripts
├── docker-compose.yml     # Container orchestration
└── package.json           # Root workspace scripts
```

**Components:**

- **Plugin**: VS Code extension that tracks file activity and integrates with the server
- **Server**: Express API that receives and stores activity data and patches
- **Dashboard**: React web UI for monitoring team activity in real-time

**Components:**

- **Plugin**: VS Code extension that tracks file activity and integrates with the server
- **Server**: Express API that receives and stores activity data and patches
- **Dashboard**: React web UI for monitoring team activity in real-time

## Quick Start

### Prerequisites

- **Node.js**: 18.x or higher (20.x recommended for packaging)
- **npm**: 9.x or higher
- **Docker**: For running the server (optional but recommended)
- **VS Code**: 1.85.0 or higher

### One-Command Setup

The fastest way to try the complete application:

```bash
# Clone the repository
git clone https://github.com/kmarkussen/vs-code-work-share-plugin.git
cd work-share

# Install all dependencies
npm run install:all

# Build and start everything
npm run try
```

This command will:

1. ✅ Build the plugin TypeScript code
2. ✅ Start the server in Docker (detached mode)
3. ✅ Open VS Code in the workspace

**Next step:** Press **F5** in VS Code to launch the Extension Development Host.

**When finished:**

```bash
npm run try:stop
```

## Development

### Setting Up Your Development Environment

**1. Install dependencies:**

```bash
# Install all dependencies (plugin + server + dashboard)
npm run install:all

# Or install individually:
npm run install:plugin    # Just the VS Code extension
npm run install:server    # Server + Dashboard
```

**2. Start the server:**

```bash
# Option A: Using Docker (recommended)
npm start
# Server available at http://localhost:3000

# Option B: Development mode with hot-reload
npm run dev:server
```

**3. Start plugin compilation in watch mode:**

```bash
npm run dev:plugin
# Automatically recompiles on file changes
```

**4. Launch the extension:**

- Open VS Code in the workspace folder
- Press **F5** (or Run > Start Debugging)
- This opens a new "Extension Development Host" window
- The extension is now loaded and active

### Development Workflow

**Making changes to the plugin:**

```bash
# Terminal 1: Watch mode (auto-compile)
cd plugin
npm run watch

# Terminal 2: Run tests after changes
npm test

# VS Code: Press Shift+F5 to reload Extension Development Host
```

**Making changes to the server:**

```bash
# Hot-reload development mode
npm run dev:server

# Or restart Docker containers
npm run docker:restart
```

**Making changes to the dashboard:**

```bash
cd server/client

# Development mode with hot module replacement
npm run dev
# Dashboard available at http://localhost:5173

# Build for production
npm run build
# Outputs to server/public/
```

### Running Tests

**Plugin tests:**

```bash
# Run all tests
npm test

# From plugin directory
cd plugin
npm test

# Watch mode (run tests on file changes)
npm run watch & npm test
```

**Test structure:**

- `plugin/src/test/suite/extension.test.ts` - Extension activation and commands
- `plugin/src/test/suite/apiClient.test.ts` - API client integration
- `plugin/src/test/suite/fileActivityTracker.test.ts` - Activity tracking logic

**Debugging tests:**

1. Open Run and Debug view (Ctrl+Shift+D)
2. Select "Extension Tests" configuration
3. Press F5 or click the green play button
4. Set breakpoints in test files

## Building

### Building for Production

**Build all components:**

```bash
npm run build
```

This compiles:

- ✅ Plugin TypeScript → JavaScript (`plugin/out/`)
- ✅ Server TypeScript → JavaScript (`server/dist/`)
- ✅ Dashboard React → Static files (`server/public/`)

**Build individual components:**

```bash
# Plugin only
npm run build:plugin
# Output: plugin/out/extension.js

# Server only
npm run build:server
# Output: server/dist/ + server/public/

# Dashboard only
cd server/client
npm run build
# Output: server/public/
```

### Build Verification

**Check for errors:**

```bash
# Compile and lint
npm run build
npm run lint

# Run tests
npm test
```

**Expected output:**

```
plugin/
├── out/
│   ├── extension.js
│   ├── apiClient.js
│   ├── fileActivityTracker.js
│   └── ... (all compiled JS files)

server/
├── dist/
│   ├── app.js
│   └── controllers/
└── public/
    ├── index.html
    └── assets/
        ├── index-[hash].js
        └── index-[hash].css
```

### Code Quality Checks

```bash
# Lint everything
npm run lint

# Fix auto-fixable lint errors
cd plugin && npm run lint -- --fix
cd server && npm run lint -- --fix

# Type checking (automatic during compile)
npm run build
```

## Packaging

### Creating a VSIX File

A VSIX file is the installation package for VS Code extensions. It contains your compiled extension and can be installed locally, shared with your team, or published to the VS Code Marketplace.

**Requirements:**

- Node.js 20+ (for @vscode/vsce compatibility)
- All dependencies installed
- Plugin must compile without errors

**Create the VSIX package:**

```bash
# Production release
npm run package

# Pre-release version (for beta testing)
npm run package:prerelease
```

**What this does:**

1. ✅ Compiles the plugin TypeScript code
2. ✅ Validates the package.json manifest
3. ✅ Bundles all necessary files
4. ✅ Creates `plugin/work-share-<version>.vsix`
5. ✅ Displays installation instructions

**Sample output:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Work Share Extension Packaging
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Step 1/3: Compiling TypeScript
   Building extension source code...
   ✓ Compilation successful

📦 Step 2/3: Running vsce package
   Creating VSIX file using @vscode/vsce...
   ✓ Packaging successful

📊 Step 3/3: Package Information
   File: work-share-0.0.1.vsix
   Size: 1.2 MB
   Location: /path/to/plugin/work-share-0.0.1.vsix

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Extension packaged successfully!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Manual Packaging (Advanced)

If you need more control over the packaging process:

```bash
cd plugin

# Install vsce if not already installed
npm install -g @vscode/vsce

# Create package with specific options
vsce package --out ../releases/

# Create pre-release version
vsce package --pre-release

# Skip license validation (if needed)
vsce package --skip-license

# Specify target platform (for platform-specific builds)
vsce package --target linux-x64
vsce package --target darwin-x64
vsce package --target win32-x64
```

**Package contents:**
The VSIX file includes:

- Compiled JavaScript files (`out/`)
- Package manifest (`package.json`)
- Extension icon and resources (`resources/`)
- README and license files
- Dependencies (from `node_modules/`)

**What's excluded:**

- Source TypeScript files (`src/`)
- Test files (`test/`)
- Development dependencies
- `.vscode/` settings
- `.git/` repository data

See `.vscodeignore` for the complete exclusion list.

## Deployment

### Installing the Extension Locally

**Method 1: From VSIX file (recommended)**

```bash
# After creating the VSIX package
cd plugin

# Install in VS Code
code --install-extension work-share-0.0.1.vsix
```

**Method 2: Via VS Code UI**

1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X / Cmd+Shift+X)
3. Click the `...` menu at the top
4. Select "Install from VSIX..."
5. Navigate to `plugin/work-share-0.0.1.vsix`
6. Click "Install"
7. Reload VS Code when prompted

**Verify installation:**

```bash
# List installed extensions
code --list-extensions | grep work-share

# Or check in VS Code
# Extensions view > Search for "Work Share"
```

### Sharing with Your Team

**1. Prepare the package:**

```bash
npm run package
```

**2. Distribute the VSIX file:**

**Option A: Direct file sharing**

- Email the `work-share-0.0.1.vsix` file
- Share via Slack, Teams, or file sharing service
- Recipients install using the methods above

**Option B: Internal package repository**

```bash
# Host on internal web server
cp plugin/work-share-0.0.1.vsix /var/www/extensions/

# Team members download and install
curl -O https://your-company.com/extensions/work-share-0.0.1.vsix
code --install-extension work-share-0.0.1.vsix
```

**Option C: Git repository releases**

```bash
# Create a GitHub/GitLab release
git tag v0.0.1
git push origin v0.0.1

# Attach the VSIX file to the release
# Team members download from the releases page
```

### Deploying the Server

**Development/Testing Environment:**

```bash
# Start with Docker Compose
npm start

# Or manually
cd server
npm install
npm run build
npm run dev
```

**Production Environment:**

**Option 1: Docker Compose (Recommended)**

```bash
# Build and start the production server
docker-compose up -d

# View logs
docker-compose logs -f work-share-server

# Stop server
docker-compose down
```

**Option 2: Manual Deployment**

```bash
# On the server machine
cd server

# Install production dependencies only
npm ci --production

# Build the application
npm run build

# Set environment variables
export NODE_ENV=production
export PORT=3000

# Start the server
npm start

# Or use a process manager (recommended)
npm install -g pm2
pm2 start dist/app.js --name work-share-server
pm2 save
pm2 startup
```

**Option 3: Cloud Platform Deployment**

<details>
<summary><b>Deploy to Heroku</b></summary>

```bash
# Install Heroku CLI
# https://devcenter.heroku.com/articles/heroku-cli

# Login and create app
heroku login
heroku create work-share-server

# Configure from the server directory
cd server
heroku config:set NODE_ENV=production

# Deploy
git subtree push --prefix server heroku master

# View logs
heroku logs --tail
```

</details>

<details>
<summary><b>Deploy to Google Cloud Run</b></summary>

```bash
# Install Google Cloud SDK
# https://cloud.google.com/sdk/docs/install

# Authenticate and set project
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Build and deploy from server directory
cd server
gcloud run deploy work-share-server \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated

# Get the service URL
gcloud run services describe work-share-server --region us-central1
```

</details>

<details>
<summary><b>Deploy to AWS Elastic Container Service</b></summary>

```bash
# Install AWS CLI
# https://aws.amazon.com/cli/

# Build and push Docker image
cd server
docker build -t work-share-server .
docker tag work-share-server:latest YOUR_ACCOUNT.dkr.ecr.REGION.amazonaws.com/work-share:latest

# Authenticate with ECR
aws ecr get-login-password --region REGION | docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.REGION.amazonaws.com

# Push image
docker push YOUR_ACCOUNT.dkr.ecr.REGION.amazonaws.com/work-share:latest

# Deploy to ECS (create task definition and service via AWS Console or CLI)
aws ecs create-service \
  --cluster work-share-cluster \
  --service-name work-share-server \
  --task-definition work-share-task \
  --desired-count 1 \
  --launch-type FARGATE
```

</details>

### Server Configuration

**Environment Variables:**

```bash
# .env file (for local development)
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
```

**docker-compose.yml configuration:**

```yaml
version: "3.8"
services:
    work-share-server:
        build:
            context: ./server
            dockerfile: Dockerfile
        ports:
            - "3000:3000"
        environment:
            - NODE_ENV=production
            - PORT=3000
        restart: unless-stopped
        volumes:
            - ./server/data:/app/data # Persist data
```

### Health Checks

Verify server deployment:

```bash
# Check server health
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","timestamp":"2026-03-07T12:00:00.000Z"}

# Check activities endpoint
curl http://localhost:3000/activities

# View dashboard
open http://localhost:3000
```

## Configuration

### Plugin Configuration

Configure the extension via VS Code settings:

**Method 1: Settings UI**

1. Open Settings (Ctrl+, / Cmd+,)
2. Search for "Work Share"
3. Configure the following options:

**Method 2: settings.json**

```json
{
    "workShare.apiServerUrl": "http://localhost:3000",
    "workShare.userName": "John Doe",
    "workShare.enabled": true,
    "workShare.updateInterval": 5000,
    "workShare.autoCheckConflictsOnSave": false
}
```

**Configuration Options:**

| Setting                              | Type    | Default | Description                                                  |
| ------------------------------------ | ------- | ------- | ------------------------------------------------------------ |
| `workShare.apiServerUrl`             | string  | `""`    | API server URL for reporting file activity                   |
| `workShare.userName`                 | string  | `""`    | User name for identification (leave empty to use git config) |
| `workShare.enabled`                  | boolean | `true`  | Enable file activity tracking                                |
| `workShare.updateInterval`           | number  | `5000`  | Interval (ms) for checking file activity                     |
| `workShare.autoCheckConflictsOnSave` | boolean | `false` | Automatically check for conflicts on file save               |

**Setting via Command Line:**

```bash
# Set API server URL
code --user-data-dir=/path/to/data \
  --install-extension work-share-0.0.1.vsix \
  --force

# Configuration is stored in:
# ~/.config/Code/User/settings.json (Linux)
# ~/Library/Application Support/Code/User/settings.json (macOS)
# %APPDATA%\Code\User\settings.json (Windows)
```

### Team Configuration

**Shared team settings (.vscode/settings.json):**

```json
{
    "workShare.apiServerUrl": "https://work-share.your-company.com",
    "workShare.updateInterval": 10000,
    "workShare.autoCheckConflictsOnSave": true
}
```

Commit this file to your repository so all team members use the same server.

### Server Configuration

Edit `docker-compose.yml` to configure the server:

```yaml
version: "3.8"
services:
    work-share-server:
        build:
            context: ./server
            dockerfile: Dockerfile
        ports:
            - "3000:3000" # Change port if needed
        environment:
            - NODE_ENV=production
            - PORT=3000
            - LOG_LEVEL=info # debug, info, warn, error
        restart: unless-stopped
```

## API Reference

### Server Endpoints

**Base URL:** `http://localhost:3000`

#### POST /activities

Submit file activity data from the extension.

**Request:**

```bash
curl -X POST http://localhost:3000/activities \
  -H "Content-Type: application/json" \
  -d '{
    "activities": [
      {
        "filePath": "/path/to/file.ts",
        "userName": "John Doe",
        "timestamp": "2026-03-07T10:30:00.000Z",
        "action": "open",
        "repositoryRemoteUrl": "https://github.com/org/repo.git"
      }
    ]
  }'
```

**Response:**

```json
{
    "success": true,
    "message": "Received 1 activities",
    "timestamp": "2026-03-07T10:30:01.000Z"
}
```

#### GET /activities

Retrieve tracked activities.

**Query Parameters:**

- `repositoryRemoteUrl` (optional): Filter by repository
- `userName` (optional): Filter by user

**Request:**

```bash
curl "http://localhost:3000/activities?repositoryRemoteUrl=https://github.com/org/repo.git"
```

**Response:**

```json
{
    "count": 2,
    "activities": [
        {
            "filePath": "/path/to/file.ts",
            "userName": "John Doe",
            "timestamp": "2026-03-07T10:30:00.000Z",
            "action": "edit",
            "repositoryRemoteUrl": "https://github.com/org/repo.git"
        }
    ]
}
```

#### POST /patches

Submit repository-relative unified diff patches.

**Request:**

```bash
curl -X POST http://localhost:3000/patches \
  -H "Content-Type: application/json" \
  -d '{
    "repositoryRemoteUrl": "https://github.com/org/repo.git",
    "repositoryFilePath": "src/file.ts",
    "userName": "John Doe",
    "baseCommitHash": "abc123",
    "patch": "--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,3 +1,4 @@\n+added line\n existing line"
  }'
```

**Response:**

```json
{
    "success": true,
    "message": "Patch received",
    "timestamp": "2026-03-07T10:30:01.000Z"
}
```

#### GET /patches

Retrieve shared patches.

**Query Parameters:**

- `repositoryRemoteUrl` (optional): Filter by repository
- `repositoryFilePath` (optional): Filter by file path
- `userName` (optional): Filter by user

**Request:**

```bash
curl "http://localhost:3000/patches?userName=John+Doe"
```

**Response:**

```json
{
    "count": 1,
    "patches": [
        {
            "repositoryRemoteUrl": "https://github.com/org/repo.git",
            "repositoryFilePath": "src/file.ts",
            "userName": "John Doe",
            "baseCommitHash": "abc123",
            "patch": "...",
            "timestamp": "2026-03-07T10:30:00.000Z"
        }
    ]
}
```

#### GET /health

Health check endpoint.

**Request:**

```bash
curl http://localhost:3000/health
```

**Response:**

```json
{
    "status": "ok",
    "timestamp": "2026-03-07T10:30:00.000Z"
}
```

### Extension Commands

Access via Command Palette (Ctrl+Shift+P / Cmd+Shift+P):

| Command                                   | Description                            |
| ----------------------------------------- | -------------------------------------- |
| `Work Share: Show File Activity`          | Opens the file activity view           |
| `Work Share: Configure Settings`          | Opens settings focused on Work Share   |
| `Work Share: Toggle Tracking`             | Enable/disable activity tracking       |
| `Work Share: Check Active File Conflicts` | Check current file for merge conflicts |
| `Work Share: Check Project Conflicts`     | Scan all tracked files for conflicts   |

### Dashboard Interface

Access the web dashboard at `http://localhost:3000` when the server is running.

**Features:**

- **Repositories Tab**: View activity and patch counts per repository
- **Users Tab**: See team members' recent activity and last seen time
- **Patches Tab**: Browse code patches with syntax-highlighted diffs
- **Auto-refresh**: Updates every 5 seconds automatically

## Troubleshooting

### Common Issues

**Issue: Extension doesn't load in VS Code**

```bash
# Check if extension is installed
code --list-extensions | grep work-share

# Reinstall the extension
code --uninstall-extension work-share
code --install-extension plugin/work-share-0.0.1.vsix

# Check VS Code developer tools
# Help > Toggle Developer Tools > Console tab
```

**Issue: Cannot connect to server**

```bash
# Verify server is running
curl http://localhost:3000/health

# Check Docker containers
docker ps | grep work-share

# View server logs
docker-compose logs -f work-share-server

# Restart server
npm run docker:restart
```

**Issue: Compilation errors**

```bash
# Clean and rebuild
npm run clean
npm run install:all
npm run build

# Check TypeScript version
cd plugin && npx tsc --version
cd server && npx tsc --version
```

**Issue: Tests failing**

```bash
# Ensure dependencies are installed
cd plugin && npm install

# Run tests with verbose output
npm test -- --verbose

# Check for required system libraries (Linux)
sudo apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
```

**Issue: VSIX packaging fails with Node.js version error**

```bash
# Check Node.js version
node --version

# Upgrade to Node.js 20+ using nvm
nvm install 20
nvm use 20
nvm alias default 20

# Reinstall vsce
cd plugin
npm install @vscode/vsce

# Try packaging again
npm run package
```

## Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Build and verify: `npm run build`
6. Commit your changes: `git commit -am 'Add new feature'`
7. Push to the branch: `git push origin feature/my-feature`
8. Create a Pull Request

### Code Style

```bash
# Run linter
npm run lint

# Auto-fix lint errors
cd plugin && npm run lint -- --fix
cd server && npm run lint -- --fix
```

### Testing Guidelines

- Write tests for new features
- Ensure all tests pass before committing
- Maintain test coverage above 80%

### Documentation

- Update README.md for user-facing changes
- Update agents.md for development documentation
- Add JSDoc comments to public APIs
- Include code examples in documentation

## Resources

### Official Documentation

- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Extension Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VSCE CLI Tool](https://github.com/microsoft/vscode-vsce)
- [Express.js Documentation](https://expressjs.com/)
- [React Documentation](https://react.dev/)
- [Docker Documentation](https://docs.docker.com/)

### Project Documentation

- [agents.md](agents.md) - Detailed development documentation
- [plugin/README.md](plugin/README.md) - Extension-specific information
- [server/README.md](server/README.md) - Server-specific information

### Community

- **Issues**: Report bugs and request features on GitHub
- **Discussions**: Ask questions and share ideas
- **Pull Requests**: Contribute code and documentation

## License

MIT License - See [LICENSE](LICENSE) file for details

## Acknowledgments

Built with:

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Express](https://expressjs.com/)
- [React](https://react.dev/)
- [Material-UI](https://mui.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Docker](https://www.docker.com/)

---

**Need help?** Check [agents.md](agents.md) for detailed development documentation or open an issue on GitHub.
