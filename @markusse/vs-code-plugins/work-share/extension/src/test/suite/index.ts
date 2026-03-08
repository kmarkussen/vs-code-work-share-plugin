import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";

/**
 * Discovers compiled `*.test.js` files and runs them with Mocha.
 */
export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        color: true,
    });

    const testsRoot = path.resolve(__dirname, "..");

    return new Promise((resolve, reject) => {
        // Resolve test files from the compiled output directory.
        glob("**/**.test.js", { cwd: testsRoot })
            .then((files) => {
                // Add files to the test suite
                files.forEach((testFile) => mocha.addFile(path.resolve(testsRoot, testFile)));

                try {
                    // Run the mocha test
                    mocha.run((failures: number) => {
                        if (failures > 0) {
                            reject(new Error(`${failures} tests failed.`));
                        } else {
                            resolve();
                        }
                    });
                } catch (err) {
                    console.error(err);
                    reject(err);
                }
            })
            .catch((err) => {
                return reject(err);
            });
    });
}
