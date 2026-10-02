import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
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
  writeFileSync(join(stage, file === "installer.nsh" ? "katarune.nsh" : file), "\uFEFF" + readFileSync(join(root, "resources/installer", file), "utf8").replace(/^\uFEFF/, ""));
}
// Adapt the locked templates in staging, preserving the upstream retry/update
// machinery. Fail on template drift rather than silently losing progress hooks.
const templates = join(root, "node_modules/app-builder-lib/templates/nsis");
for (const directory of [templates, join(templates, "include")]) {
  for (const file of readdirSync(directory).filter(file => file.endsWith(".nsh")))
    writeFileSync(join(stage, file), readFileSync(join(directory, file)));
}
function adapt(file, edits) {
  let source = readFileSync(join(templates, file), "utf8");
  for (const [before, after] of edits) {
    if (!source.includes(before)) throw new Error(`NSIS template changed: ${file}: ${before}`);
    source = source.replaceAll(before, after);
  }
  writeFileSync(join(stage, file.split("/").at(-1)), "\uFEFF" + source);
}
const phase = (base, span, text) => String.raw`System::Call '$PLUGINSDIR\KataruneSkin.dll::ProgressPhase(i ${base}, i ${span}, w "${text}") v c'`;
adapt("include/extractAppPackage.nsh", [
  ['  !insertmacro identify_package', `  ${phase(0, 10, "正在读取应用压缩包…")}\n  SetDetailsPrint both\n  !insertmacro identify_package`],
  ['  Nsis7z::Extract "${FILE}"', `  ${phase(10, 75, "正在解压应用文件…")}\n  Nsis7z::ExtractWithDetails "\${FILE}" "解压：%s"`],
  ['    CopyFiles /SILENT', `    ${phase(85, 10, "正在写入应用文件…")}\n    CopyFiles /SILENT`],
]);
adapt("uninstaller.nsh", [
  ['    RMDir /r $INSTDIR', `    ${phase(15, 75, "正在移除应用文件…")}\n    SetDetailsPrint both\n    RMDir /r $INSTDIR`],
  ['  ${ifNot} ${isKeepShortcuts}', `  ${phase(90, 9, "正在移除快捷方式和安装信息…")}\n  \${ifNot} \${isKeepShortcuts}`],
]);
// NSIS resolves includes in the current directory before include search paths.
writeFileSync(wrapper, `\uFEFF!cd "${stage}"\n!define KATARUNE_HELPER_DIR "${stage}"\n!define KATARUNE_DATA_NAME "${options["data-name"] ?? "katarune"}"\n!define KATARUNE_UNITY_PRODUCT "${options["unity-product"] ?? "Katarune Avatar Desktop"}"\n!include "${join(stage, "katarune.nsh")}"\n`);
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
