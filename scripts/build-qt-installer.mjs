import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (!match) throw new Error(`Invalid argument: ${arg}`);
  return [match[1], match[2]];
}));
const payload = resolve(options.payload ?? join(root, "dist/win-unpacked"));
const product = options.product ?? "Katarune";
const executable = options.exe ?? "Katarune.exe";
const dataName = options["data-name"] ?? "katarune";
const unityProduct = options["unity-product"] ?? "Katarune Avatar Desktop";
for (const name of [product, executable, dataName, unityProduct]) {
  if (!name || /[\\/:*?"<>|@\x00-\x1f]/.test(name) || name === "." || name === "..") throw new Error("Invalid product identity");
}
const stage = resolve(root, options.stage ?? "build/installer-qt");
const stageRelative = relative(join(root, "build"), stage);
if (!stageRelative || stageRelative.startsWith("..") || isAbsolute(stageRelative)) throw new Error("Stage must be inside build/");
const qtRoot = resolve(process.env.QT_IFW_ROOT ?? join(root, "build/qt-ifw/4.8.1"));
const binarycreator = join(qtRoot, "bin/binarycreator.exe");
if (!existsSync(binarycreator)) throw new Error("Qt IFW is missing. Run npm run setup:installer or set QT_IFW_ROOT to an installed Qt IFW SDK.");
if (!existsSync(join(payload, executable))) throw new Error(`Missing installer payload: ${payload}/${executable}`);
const compression = options.compression ?? "5";
if (!["0", "1", "3", "5", "7", "9"].includes(compression)) throw new Error("Compression must be 0, 1, 3, 5, 7, or 9");
const suffix = compression === "0" ? "-test" : "";
const output = resolve(options.output ?? join(root, `dist/${product}-Setup-${manifest.version}${suffix}.exe`));
const substitutions = {
  PRODUCT: product, VERSION: manifest.version, EXE: executable,
  DATE: new Date().toISOString().slice(0, 10),
  TARGET: options.target ?? `@LocalAppData@/Programs/${product}`,
};
substitutions.DATANAME = dataName;
substitutions.UNITYPRODUCT = unityProduct;
function template(name) {
  return readFileSync(join(root, "resources/installer", name), "utf8")
    .replace(/@@([A-Z_]+)@@/g, (token, key) => {
      if (key === "PAGE") return token;
      if (!(key in substitutions)) throw new Error(`Unknown installer template: ${token}`);
      return name.endsWith(".xml") ? xmlEscape(substitutions[key]) : substitutions[key];
    });
}
function xmlEscape(value) {
  return value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
}
// Stage only the validated payload within build/ using native PowerShell.
const staged = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
  "-File", join(root, "scripts/stage-qt-installer.ps1"), "-Stage", stage, "-Payload", payload, "-QtRoot", qtRoot], { stdio: "inherit" });
if (staged.error) throw staged.error;
if (staged.status !== 0) process.exit(staged.status ?? 1);
const config = join(stage, "config");
const componentRoot = join(stage, "packages/app.katarune.desktop");
const meta = join(componentRoot, "meta");
const data = join(componentRoot, "data");
mkdirSync(config, { recursive: true });
mkdirSync(meta, { recursive: true });
mkdirSync(join(data, ".installer"), { recursive: true });
writeFileSync(join(data, ".installer/identity.json"), JSON.stringify({ product, dataName, unityProduct }));
for (const file of ["component.qs", "package.xml"]) writeFileSync(join(meta, file), template(file));
for (const page of ["Options", "Progress", "Finished"]) {
  let pageUi = template("Canvas.ui").replaceAll("@@PAGE@@", page);
  writeFileSync(join(meta, `${page}.ui`), pageUi);
}
const xml = readFileSync(join(root, "resources/installer/config.xml"), "utf8")
  .replace(/@@([A-Z]+)@@/g, (_, key) => xmlEscape(substitutions[key]));
writeFileSync(join(config, "config.xml"), xml);
for (const file of ["controller.qs", "artwork.qss"]) writeFileSync(join(config, file), template(file));
if (options.preview === "true") {
  // Preview uses the actual Qt pages and styles but cannot install or launch.
  const previewScript = `
KatarunePrepare = function () { throw new Error("界面预览不执行安装或卸载。"); };
Controller.prototype.bindActions = function (canvas) {
    gui.findChild(canvas, "Primary").clicked.connect(this, Controller.prototype.previewAdvance);
    gui.findChild(canvas, "Cancel").clicked.connect(function () { gui.rejectWithoutPrompt(); });
};
Controller.prototype.showPreviewPage = function (mode) {
    var page = gui.pageWidgetByObjectName("DynamicOptions");
    Controller.prototype.resetContent.call(this, page);
    var status = gui.findChild(page, "Status");
    var primary = gui.findChild(page, "Primary");
    var progress = gui.findChild(page, "ArtProgress");
    gui.findChild(page, "Cancel").show();
    primary.enabled = true;
    if (mode === "install") {
        gui.findChild(page, "InstallOptions").show();
        primary.text = "预览安装进度";
    } else if (mode === "uninstall") {
        status.text = "卸载言奏";
        status.show();
        gui.findChild(page, "DeleteAll").show();
        primary.text = "预览卸载进度";
    } else if (mode.indexOf("progress") !== -1) {
        status.text = mode === "install-progress" ? "正在安装" : "正在卸载";
        status.show();
        progress.value = 45;
        progress.show();
        primary.text = "预览完成页";
    } else {
        status.text = mode === "install-finished" ? "安装完成" : "卸载完成";
        status.show();
        primary.text = mode === "install-finished" ? "预览卸载页" : "关闭预览";
        gui.findChild(page, "Cancel").hide();
    }
};
Controller.prototype.previewAdvance = function () {
    this.previewStep++;
    if (this.previewStep >= this.previewPages.length) { gui.rejectWithoutPrompt(); return; }
    Controller.prototype.showPreviewPage.call(this, this.previewPages[this.previewStep]);
};
var previewOptionsCallback = Controller.prototype.DynamicOptionsCallback;
Controller.prototype.DynamicOptionsCallback = function () {
    previewOptionsCallback.call(this);
    this.previewPages = ["install", "install-progress", "install-finished", "uninstall", "uninstall-progress", "uninstall-finished"];
    this.previewStep = this.previewPages.indexOf(installer.value("KatarunePreviewPage", "install"));
    if (this.previewStep < 0) this.previewStep = 0;
    Controller.prototype.showPreviewPage.call(this, this.previewPages[this.previewStep]);
};
Controller.prototype.launchApplication = function () {};
Controller.prototype.IntroductionPageCallback = function () {
    installer.setValue("TargetDir", installer.environmentVariable("LOCALAPPDATA") + "/Programs/Katarune");
    gui.clickButton(buttons.NextButton);
};
`;
  writeFileSync(join(config, "controller.qs"), template("controller.qs") + previewScript);
  writeFileSync(join(meta, "component.qs"), template("component.qs") +
    '\nComponent.prototype.createOperations = function () { throw new Error("Preview cannot install"); };\n');
}
copyFileSync(join(root, "resources/katarune-logo.ico"), join(config, "icon.ico"));
copyFileSync(join(root, "resources/katarune-logo.png"), join(config, "icon.png"));
const resourceFiles = [
  ["common.qs", join(config, "common.qs")],
  ["prepare.ps1", join(config, "prepare.ps1")],
  ["cleanup.ps1", join(config, "cleanup.ps1")],
  ["background.png", join(root, "resources/installer-background-clean-v2.png")],
  ["logo.png", join(root, "resources/katarune-logo.png")],
];
// Windows PowerShell 5.1 requires a BOM to read Chinese text in scripts.
writeFileSync(join(config, "prepare.ps1"), "\uFEFF" + template("prepare.ps1"));
writeFileSync(join(config, "common.qs"), template("common.qs"));
writeFileSync(join(config, "cleanup.ps1"), "\uFEFF" + template("cleanup.ps1"));
const qrc = `<RCC><qresource prefix="/katarune">${resourceFiles.map(([alias, path]) =>
  `<file alias="${alias}">${xmlEscape(path.replaceAll("\\", "/"))}</file>`).join("")}</qresource></RCC>`;
writeFileSync(join(config, "artwork.qrc"), qrc);
copyFileSync(join(config, "artwork.qrc"), join(meta, "artwork.qrc"));
// Qt's pure uninstaller does not load component interfaces. Retain a tiny
// offline metadata repository so its GUI can use the exact same Canvas files.
const maintenancePackages = join(stage, "maintenance-ui/packages");
const maintenanceMeta = join(maintenancePackages, "app.katarune.desktop/meta");
mkdirSync(maintenanceMeta, { recursive: true });
mkdirSync(join(maintenancePackages, "app.katarune.desktop/data"), { recursive: true });
for (const file of readdirSync(meta)) copyFileSync(join(meta, file), join(maintenanceMeta, file));
const repository = spawnSync(join(qtRoot, "bin/repogen.exe"), ["-p", maintenancePackages, join(data, ".installer/ui-repository")], { stdio: "inherit" });
if (repository.error) throw repository.error;
if (repository.status !== 0) process.exit(repository.status ?? 1);
mkdirSync(resolve(output, ".."), { recursive: true });
const result = spawnSync(binarycreator, ["--offline-only", "--compression", compression, "-c", join(config, "config.xml"),
  "-p", join(stage, "packages"), "-r", join(config, "artwork.qrc"), output], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Qt IFW installer: ${output}`);
