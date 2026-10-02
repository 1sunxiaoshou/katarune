import { spawnSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getMakeNsisPath } from "app-builder-lib/out/toolsets/windows.js";

const root = resolve(import.meta.dirname, "..");
const stage = join(root, "build/installer-nsis-preview");
const pages = ["install", "install-progress", "install-finished", "uninstall", "uninstall-progress", "uninstall-finished"];
const selected = process.argv[2]?.replace(/^--page=/, "") ?? "install";
if (!pages.includes(selected)) throw new Error(`Unknown preview page: ${selected}`);
mkdirSync(stage, { recursive: true });
const compiled = spawnSync("pwsh.exe", ["-NoProfile", "-File", join(root, "scripts/build-installer-skin.ps1")], { stdio: "inherit", windowsHide: true });
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
const output = join(stage, "Katarune-UI-Preview.exe");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const script = `Unicode true
; This preview intentionally never executes sections.
!pragma warning disable 8000
RequestExecutionLevel user
Name "Katarune界面预览"
OutFile "${output}"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
Var Dialog
Var Step
Page custom Preview Advance
Page custom Preview Advance
Page custom Preview Advance
Page custom Preview Advance
Page custom Preview Advance
Page custom Preview Advance
Section
SectionEnd
Function .onInit
  StrCpy $Step ${pages.indexOf(selected)}
  StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\Katarune"
FunctionEnd
Function .onGUIInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\\KataruneSkin.dll "${join(root, "build/installer-nsis/KataruneSkin.dll")}"
  File /oname=$PLUGINSDIR\\background.png "${join(root, "resources/installer-background.png")}"
  File /oname=$PLUGINSDIR\\logo.png "${join(root, "resources/katarune-logo.png")}"
  System::Call '$PLUGINSDIR\\KataruneSkin.dll::Attach(p $HWNDPARENT, w "$PLUGINSDIR", w "${pkg.version}") v c'
FunctionEnd
Function Preview
  nsDialogs::Create 1018
  Pop $Dialog
  System::Call '$PLUGINSDIR\\KataruneSkin.dll::HideNativePage(p $Dialog) v c'
  System::Call '$PLUGINSDIR\\KataruneSkin.dll::PreviewPage(i $Step, w "$INSTDIR") v c'
  ; Preview deliberately has no installation, uninstall, registry or launch code.
  nsDialogs::Show
FunctionEnd
Function Advance
  System::Call '$PLUGINSDIR\\KataruneSkin.dll::ReadLaunch() i .r0 c'
  StrCmp $0 "0" 0 +2
  Quit
  IntOp $Step $Step + 1
  IntOp $Step $Step % 6
FunctionEnd
`;
writeFileSync(join(stage, "preview.nsi"), "\uFEFF" + script);
const compiler = await getMakeNsisPath();
const result = spawnSync(compiler.path, ["/V2", join(stage, "preview.nsi")], { env: { ...process.env, ...compiler.env }, stdio: "inherit", windowsHide: true });
if (result.status !== 0) process.exit(result.status ?? 1);
const preview = spawn(output, [], { detached: true, stdio: "ignore", windowsHide: false });
preview.unref();
console.log(`NSIS UI preview: ${output}`);
