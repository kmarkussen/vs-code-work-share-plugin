import * as path from "path";
import { runTests } from "@vscode/test-electron";

/**
 * Boots an Extension Development Host and executes integration tests.
 */
async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        const extensionDevelopmentPath = path.resolve(__dirname, "../../");

        // The path to test runner
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        // Download VS Code, unzip it and run the integration test
        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        // Exit with failure so CI and npm scripts report test execution errors.
        console.error("Failed to run tests");
        process.exit(1);
    }
}

main();
