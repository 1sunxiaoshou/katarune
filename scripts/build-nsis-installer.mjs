import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { build, Platform, Arch } from "electron-builder";
import { verifyWindowsResources } from "./verify-windows-resources.mjs";

const root = resolve(import.meta.dirname, "..");
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)=(.*)$/.exec(arg);
  if (!match) throw new Error(`Expected --name=value: ${arg}`);
  return [match[1], match[2]];
}));
const payload = resolve(options.payload ?? join(root, "dist/win-unpacked"));
if (!options.payload) await verifyWindowsResources(join(payload, "resources"), true);
for (const key of ["product", "data-name", "unity-product"]) {
  if (options[key] && !/^[A-Za-z0-9 ._-]+$/.test(options[key])) throw new Error(`Invalid ${key}`);
}
if (options["ui-test"] && (!options.product?.startsWith("KataruneNsisTest-") || !options.payload)) throw new Error("UI driver is only available for isolated test fixtures");
const compiled = spawnSync("pwsh.exe", ["-NoProfile", "-File", join(root, "scripts/build-installer-skin.ps1"), ...(options["ui-test"] === "true" ? ["-TestUI"] : [])], { stdio: "inherit", windowsHide: true });
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
const stage = resolve(options.stage ?? join(root, "build/installer-nsis"));
mkdirSync(stage, { recursive: true });
const product = options.product ?? "Katarune";
const wrapper = join(stage, "include.nsh");
for (const file of ["cleanup.ps1", "prepare.ps1", "installer.nsh"]) {
  writeFileSync(join(stage, file), "\uFEFF" + readFileSync(join(root, "resources/installer", file), "utf8").replace(/^\uFEFF/, ""));
}
writeFileSync(wrapper, `\uFEFF!define KATARUNE_HELPER_DIR "${stage}"\n!define KATARUNE_DATA_NAME "${options["data-name"] ?? "katarune"}"\n!define KATARUNE_UNITY_PRODUCT "${options["unity-product"] ?? "Katarune Avatar Desktop"}"\n!include "${join(stage, "installer.nsh")}"\n`);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
await build({
  targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
  prepackaged: payload,
  publish: "never",
  config: {
    extends: join(root, "electron-builder.yml"),
    ...(options.product ? { productName: product, appId: `app.katarune.test.${product.toLowerCase()}`, extraMetadata: { name: options["data-name"] ?? product.toLowerCase() } } : {}),
    directories: { output: options.output ? resolve(options.output) : join(root, "dist"), buildResources: join(root, "resources") },
    nsis: { include: wrapper, artifactName: `${product}-Setup-${pkg.version}.exe` },
  },
});
