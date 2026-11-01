const assert = require("node:assert/strict");
const { join } = require("node:path");
const Database = require("better-sqlite3");

async function run() {
  const database = new Database(":memory:");
  let statements = 0;
  try {
    for (let batch = 0; batch < 25; batch++) {
      let garbage = [];
      for (let index = 0; index < 4000; index++) {
        const row = database.prepare("SELECT ? AS value").get(statements++);
        assert.equal(row.value, statements - 1);
        // Allocation-driven GC reproduces the ObjectWrap cleanup crash; an
        // explicit global.gc() alone does not exercise the failing context.
        garbage.push({ row, payload: Array(50).fill(statements) });
        if (index % 100 === 0) garbage = [];
      }
      await new Promise(setImmediate);
    }
  } finally {
    database.close();
  }
  console.log(`[sqlite-gc] passed ${statements} statements; node=${process.versions.node}; electron=${process.versions.electron ?? "none"}`);
}

if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
  const { app } = require("electron");
  const directory = process.env.KATARUNE_SQLITE_GC_TEST_DIR;
  assert.ok(directory, "An isolated SQLite GC test directory is required");
  app.setPath("userData", join(directory, "user-data"));
  app.setPath("sessionData", join(directory, "session-data"));
  app.commandLine.appendSwitch("disable-gpu");
  void app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
} else {
  void run().catch(error => { console.error(error); process.exitCode = 1; });
}
