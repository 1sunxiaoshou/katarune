import assert from "node:assert/strict";
import { createServer } from "node:http";
import { app } from "electron";

const directory = process.env.KATARUNE_SHUTDOWN_TEST_DIR;
assert.ok(directory, "An isolated shutdown test directory is required");
app.setPath("userData", directory);
app.commandLine.appendSwitch("disable-gpu");

void app.whenReady().then(async () => {
  // Exercise the delayed V8 tasks from Node #61999 / Electron #53013 using
  // loopback traffic only. The real Electron process must then exit cleanly.
  const server = createServer((_request, response) => {
    response.writeHead(302, { Location: "/" });
    response.end();
  });
  let exitCode = 0;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(fetch(`http://127.0.0.1:${address.port}/`), TypeError);
    if (process.argv.includes("--fail")) assert.fail("Intentional shutdown fixture failure");
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
    console.log(`[electron-shutdown] workload complete; electron=${process.versions.electron}; exit=${exitCode}`);
    app.exit(exitCode);
  }
});
