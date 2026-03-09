#!/bin/bash

###############################################################################
# VS Code Extension Packaging Script
#
# This script packages the Work Share extension into a VSIX file for distribution.
# VSIX is the installation format for VS Code extensions.
#
# Documentation:
# - VS Code Extension Publishing: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
# - vsce CLI Tool: https://github.com/microsoft/vscode-vsce
# - Extension Packaging: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#packaging-extensions
#
# Prerequisites:
# - @vscode/vsce must be installed (handled automatically by npm install)
# - Extension must be compiled (TypeScript -> JavaScript)
#
# Output:
# - Creates work-share-<version>.vsix in the plugin directory
# - The VSIX file can be:
#   1. Installed locally: Open VS Code > Extensions > "..." menu > Install from VSIX
#   2. Shared with others for testing
#   3. Published to VS Code Marketplace: https://marketplace.visualstudio.com/
#
# Usage:
#   npm run package              # Create regular release package
#   npm run package:prerelease   # Create pre-release package (for beta testing)
###############################################################################

set -e  # Exit on any error

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${YELLOW}⚠️  Node.js version $NODE_VERSION detected. Attempting to switch to Node 20 via nvm...${NC}"

    if [ -z "$NVM_DIR" ]; then
        NVM_DIR="$HOME/.nvm"
    fi

    if [ -s "$NVM_DIR/nvm.sh" ]; then
        # shellcheck source=/dev/null
        . "$NVM_DIR/nvm.sh"
        if nvm use 20 >/dev/null 2>&1; then
            NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
            echo -e "${GREEN}✓ Switched to Node $(node -v)${NC}"
        fi
    fi

    if [ "$NODE_VERSION" -lt 20 ]; then
        echo -e "${RED}✗ Node.js 20+ is required for packaging${NC}"
        echo -e "${BLUE}   To resolve this:${NC}"
        echo "   1. Install Node.js 20+ from https://nodejs.org/"
        echo "   2. Or use nvm: nvm install 20 && nvm use 20"
        echo "   3. Then run: npm run build (or npm run package)"
        echo ""
        exit 1
    fi
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Work Share Extension Packaging${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get the workspace root (parent of scripts directory)
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$WORKSPACE_ROOT/@markusse/vs-code-plugins/work-share/extension"
SHARED_VSIX_DIR="$WORKSPACE_ROOT/shared/vsix"

echo -e "${YELLOW}📋 Step 1/3: Compiling TypeScript${NC}"
echo "   Building extension source code..."
cd "$PLUGIN_DIR"
npm run compile

if [ $? -eq 0 ]; then
    echo -e "${GREEN}   ✓ Compilation successful${NC}"
else
    echo -e "${RED}   ✗ Compilation failed${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}📦 Step 2/3: Running vsce package${NC}"
echo "   Creating VSIX file using @vscode/vsce..."
echo "   Documentation: https://github.com/microsoft/vscode-vsce"
cd "$PLUGIN_DIR"

# Check if --pre-release flag should be used
if [ "$1" == "--pre-release" ]; then
    echo "   Building pre-release version..."
    npm run package:prerelease
else
    npm run package
fi

if [ $? -eq 0 ]; then
    echo -e "${GREEN}   ✓ Packaging successful${NC}"
else
    echo -e "${RED}   ✗ Packaging failed${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}📊 Step 3/3: Package Information${NC}"
# Find the generated VSIX file
VSIX_FILE=$(ls -t "$PLUGIN_DIR"/*.vsix 2>/dev/null | head -1)

if [ -n "$VSIX_FILE" ]; then
    mkdir -p "$SHARED_VSIX_DIR"
    cp "$VSIX_FILE" "$SHARED_VSIX_DIR/"

    FILE_SIZE=$(du -h "$VSIX_FILE" | cut -f1)
    FILE_NAME=$(basename "$VSIX_FILE")

    echo "   File: $FILE_NAME"
    echo "   Size: $FILE_SIZE"
    echo "   Location: $VSIX_FILE"
    echo "   Shared directory: $SHARED_VSIX_DIR/$FILE_NAME"
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  ✅ Extension packaged successfully!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo ""
    echo -e "${BLUE}1. Install locally for testing:${NC}"
    echo "   • Open VS Code"
    echo "   • Go to Extensions view (Ctrl+Shift+X / Cmd+Shift+X)"
    echo "   • Click the '...' menu at the top"
    echo "   • Select 'Install from VSIX...'"
    echo "   • Choose: $VSIX_FILE"
    echo ""
    echo -e "${BLUE}2. Share with team members:${NC}"
    echo "   • Send the VSIX file via email or file sharing"
    echo "   • Recipients can install using the same steps above"
    echo ""
    echo -e "${BLUE}3. Publish to VS Code Marketplace:${NC}"
    echo "   • Create publisher account: https://marketplace.visualstudio.com/manage"
    echo "   • Get Personal Access Token from Azure DevOps"
    echo "   • Run: cd @markusse/vs-code-plugins/work-share/extension && vsce publish"
    echo "   • Guide: https://code.visualstudio.com/api/working-with-extensions/publishing-extension"
    echo ""
else
    echo -e "${RED}   ✗ Could not find generated VSIX file${NC}"
    exit 1
fi
