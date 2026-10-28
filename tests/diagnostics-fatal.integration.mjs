import { app } from "electron";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const directory = process.env.KATARUNE_DIAGNOSTICS_TEST_DIR;
if (!directory) throw new Error("Isolated directory required");
app.setAppPath(process.cwd());
app.setPath("userData", join(directory, "fatal-user-data"));
await import(pathToFileURL(resolve("out/main/index.js")).href);
queueMicrotask(() => { throw Object.assign(new TypeError("secret-fixture-never-persist"), { code: "ECONNRESET" }); });
