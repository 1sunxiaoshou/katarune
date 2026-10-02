# Real Qt IFW integration. Every application/data/registry identity is unique.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$name = "katarune-uninstall-test-$runId"
$product = "KataruneUninstallTest-$runId"
$unityProduct = "Katarune Avatar Test $runId"
$work = Join-Path $root ".test-dist/uninstall-$runId"
$fixture = Join-Path $work 'fixture'
$installed = Join-Path $work '安装目录 with spaces'
$installer = Join-Path $work "$product-Setup.exe"
$uninstaller = Join-Path $installed "Uninstall $product.exe"
$data = Join-Path $env:APPDATA $name
$cache = Join-Path $env:LOCALAPPDATA "$name-updater"
$low = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AppData/LocalLow/Katarune'
$unityData = Join-Path $low $unityProduct
$registry = "HKCU:\Software\Katarune\$unityProduct"
$devData = Join-Path $env:APPDATA "$name-development"
$devRegistry = "$registry Development"
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) "$product.lnk"
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) $product
$logNumber = 0

function Assert-Test($condition, $message) { if (-not $condition) { throw $message } }
function Write-Fixture($path, $content = 'disposable installer test data') {
    New-Item -ItemType Directory -Force (Split-Path $path -Parent) | Out-Null
    Set-Content -LiteralPath $path -Value $content -Encoding utf8
}
function Invoke-Fixture([string]$file, [string[]]$arguments) {
    $script:logNumber++
    $logPath = Join-Path $work "operation-$logNumber.log"
    # Write to a file directly so verbose graphical Qt output cannot fill a
    # redirected pipe; retain diagnostic output even when a run times out.
    $runner = @'
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const [file, log, ...args] = process.argv.slice(1);
const fd = fs.openSync(log, "w");
const result = spawnSync(file, args, { stdio: ["ignore", fd, fd], windowsHide: true, timeout: 30000 });
fs.closeSync(fd);
if (result.error) { fs.appendFileSync(log, "\n" + result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
'@
    & node -e $runner $file $logPath @arguments
    return $LASTEXITCODE
}
function Build-Fixture {
    & node scripts/build-qt-installer.mjs "--payload=$fixture" "--exe=$product.exe" "--product=$product" "--data-name=$name" "--unity-product=$unityProduct" "--output=$installer" "--stage=build/uninstall-fixture-$runId"
    Assert-Test ($LASTEXITCODE -eq 0) 'Qt fixture build failed'
}
function Seed-Data {
    Write-Fixture (Join-Path $data 'personal.txt')
    Write-Fixture (Join-Path $data 'tts-cache/cache.txt')
    Write-Fixture (Join-Path $data 'asset-staging/staged.txt')
    Write-Fixture (Join-Path $cache 'download.txt')
    Write-Fixture (Join-Path $unityData 'Player.log')
    New-Item -Path $registry -Force | Out-Null
    Set-ItemProperty -LiteralPath $registry -Name 'test' -Value 'fixture'
}
function Install-Test([string[]]$options = @()) {
    Assert-Test ((Invoke-Fixture $installer (@('--accept-licenses', '--confirm-command', 'install', "KataruneTarget=$installed") + $options)) -eq 0) 'Install failed; see operation log'
    Assert-Test (Test-Path -LiteralPath $uninstaller) 'Uninstaller missing'
}
function Uninstall-Test([string[]]$options = @()) {
    return (Invoke-Fixture $uninstaller (@('--confirm-command', 'purge') + $options))
}
function Wait-Removed {
    $deadline = (Get-Date).AddSeconds(30)
    while (Test-Path -LiteralPath $installed) {
        if ((Get-Date) -gt $deadline) { throw 'Installation directory remains' }
        Start-Sleep -Milliseconds 100
    }
}

function Write-UiController([string]$mode) {
    $source = Get-Content -LiteralPath (Join-Path $root "build/uninstall-fixture-$runId/config/controller.qs") -Raw -Encoding UTF8
    $driver = @'
var optionsCallback = Controller.prototype.DynamicOptionsCallback;
var progressCallback = Controller.prototype.PerformInstallationPageCallback;
var finishedCallback = Controller.prototype.FinishedPageCallback;
Controller.prototype.DynamicOptionsCallback = function () {
    optionsCallback.call(this);
    console.log("UI: options");
    if (installer.value("UiCancel", "false") === "true") {
        gui.findChild(gui.pageWidgetByObjectName("DynamicOptions"), "Cancel").click();
    } else {
        if (!installer.isInstaller()) gui.findChild(gui.pageWidgetByObjectName("DynamicOptions"), "DeleteAll").checked = installer.value("UiDeleteAll", "false") === "true";
        if (installer.value("UiNativeNavigation", "false") === "true") gui.clickButton(buttons.NextButton, 100);
        else gui.findChild(gui.pageWidgetByObjectName("DynamicOptions"), "Primary").click();
    }
};
Controller.prototype.PerformInstallationPageCallback = function () {
    progressCallback.call(this);
    var page = gui.pageById(QInstaller.PerformInstallation);
    if (!gui.findChild(page.Progress, "ArtProgress").visible || !gui.findChild(page.Progress, "Status").visible) throw new Error("Progress feedback hidden");
    console.log("UI: progress");
    page.ProgressBar.valueChanged.connect(function (value) { console.log("UI: progress value " + value); });
};
Controller.prototype.FinishedPageCallback = function () {
    finishedCallback.call(this);
    if (installer.status !== QInstaller.Success || installer.containsValue("KataruneCleanupError")) throw new Error("UI operation failed");
    var artwork = gui.pageById(QInstaller.InstallationFinished).Finished;
    if (!gui.findChild(artwork, "Status").visible || gui.findChild(artwork, "ArtProgress").visible || !gui.isButtonEnabled(buttons.FinishButton)) throw new Error("Finished feedback invalid");
    console.log("UI: finished");
    gui.findChild(artwork, "Primary").click();
};
'@
    $path = Join-Path $work "ui-$mode.qs"
    Set-Content -LiteralPath $path -Value ($source + "`n" + $driver) -Encoding utf8
    return $path
}

function Assert-UiLog {
    $log = Get-Content -LiteralPath (Join-Path $work "operation-$logNumber.log") -Raw
    foreach ($phase in @('UI: options', 'UI: progress', 'UI: progress value', 'UI: finished')) {
        Assert-Test ($log.Contains($phase)) "Missing GUI phase: $phase"
    }
    Assert-Test ($log -notmatch 'Critical:|TypeError:|ReferenceError:') 'Qt GUI script error; see operation log'
}

try {
Write-Fixture (Join-Path $fixture "$product.exe") 'Installer fixture; never execute.'
Write-Fixture (Join-Path $fixture 'obsolete.txt')
Write-Fixture (Join-Path $devData 'development.txt')
New-Item -Path $devRegistry -Force | Out-Null
Set-ItemProperty -LiteralPath $devRegistry -Name 'test' -Value 'development fixture'
Build-Fixture
Install-Test
Assert-Test (Test-Path -LiteralPath $desktopLink) 'Default desktop shortcut missing'
Assert-Test (Test-Path (Join-Path $startMenu "$product.lnk")) 'Start menu shortcut missing'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($desktopLink)
Assert-Test ($shortcut.TargetPath -eq (Join-Path $installed "$product.exe")) 'Shortcut points to wrong executable'
Seed-Data
Remove-Item -LiteralPath (Join-Path $fixture 'obsolete.txt')
Build-Fixture
Install-Test
foreach ($path in @((Join-Path $data 'personal.txt'), (Join-Path $data 'tts-cache/cache.txt'), (Join-Path $cache 'download.txt'), (Join-Path $unityData 'Player.log'), $registry)) {
    Assert-Test (Test-Path -LiteralPath $path) "Overwrite deleted $path"
}
Assert-Test (-not (Test-Path (Join-Path $installed 'obsolete.txt'))) 'Overwrite retained obsolete program file'
Write-Output 'PASS: overwrite preserves all user/cache/Unity data and removes obsolete program files'

Assert-Test ((Uninstall-Test) -eq 0) 'Default uninstall failed'
Wait-Removed
Assert-Test (-not (Test-Path -LiteralPath $desktopLink)) 'Desktop shortcut remains'
Assert-Test (-not (Test-Path -LiteralPath $startMenu)) 'Start menu folder remains'
Assert-Test (Test-Path (Join-Path $data 'personal.txt')) 'Default uninstall deleted personal data'
foreach ($path in @((Join-Path $data 'tts-cache'), (Join-Path $data 'asset-staging'), $cache, $unityData, $registry)) {
    Assert-Test (-not (Test-Path -LiteralPath $path)) "Default uninstall left $path"
}
Write-Output 'PASS: default uninstall removes program, shortcuts, caches and release Unity state; retains personal data'

Install-Test @('DesktopShortcut=false')
Assert-Test (-not (Test-Path -LiteralPath $desktopLink)) 'Disabled desktop shortcut was created'
Seed-Data
$locked = [IO.File]::Open((Join-Path $data 'personal.txt'), 'Open', 'Read', 'None')
try {
    Assert-Test ((Uninstall-Test @('DeleteAll=true')) -ne 0) 'Locked cleanup incorrectly reported success'
    Assert-Test (Test-Path -LiteralPath $uninstaller) 'Failed cleanup removed uninstaller'
    Assert-Test (Test-Path (Join-Path $installed "$product.exe")) 'Failed cleanup removed program'
    Assert-Test (Test-Path (Join-Path $data 'tts-cache/cache.txt')) 'Failed preflight deleted cache'
    Assert-Test (Test-Path -LiteralPath $registry) 'Failed preflight deleted Unity settings'
} finally { $locked.Dispose() }
Write-Output 'PASS: locked data stops uninstall and keeps program/uninstaller for retry'
Assert-Test ((Uninstall-Test @('DeleteAll=true')) -eq 0) 'Full uninstall failed'
Wait-Removed
foreach ($target in @($data, $cache, $unityData, $registry)) {
    Assert-Test (-not (Test-Path -LiteralPath $target)) "Full uninstall left $target"
}
Assert-Test (Test-Path (Join-Path $devData 'development.txt')) 'Uninstall removed development data'
Assert-Test (Test-Path -LiteralPath $devRegistry) 'Uninstall removed sibling Unity settings'
Write-Output 'PASS: full uninstall removes all release data; preserves development data and sibling Unity settings'

# Exercise the real Qt graphical callbacks as well as the CLI. The driver uses
# Qt's supported test control script API; no application payload is executed.
$uiController = Write-UiController 'flow'
Assert-Test ((Invoke-Fixture $installer @('--verbose', '--script', $uiController, "KataruneTarget=$installed", 'DesktopShortcut=false')) -eq 0) 'GUI install failed'
Assert-UiLog
Assert-Test (Test-Path -LiteralPath $uninstaller) 'GUI install did not produce maintenance tool'
Seed-Data
Assert-Test ((Invoke-Fixture $installer @('--verbose', '--script', $uiController, "KataruneTarget=$installed", 'UiCancel=true')) -in @(0, 3)) 'GUI cancel failed'
Assert-Test (Test-Path -LiteralPath $uninstaller) 'GUI cancel removed program'
Assert-Test (Test-Path (Join-Path $data 'personal.txt')) 'GUI cancel deleted personal data'
Assert-Test (Test-Path (Join-Path $data 'tts-cache/cache.txt')) 'GUI cancel deleted cache'
Assert-Test ((Invoke-Fixture $uninstaller @('--verbose', '--script', $uiController)) -eq 0) 'GUI default uninstall failed'
Assert-UiLog
Wait-Removed
Assert-Test (Test-Path (Join-Path $data 'personal.txt')) 'GUI default uninstall deleted personal data'
Assert-Test (-not (Test-Path (Join-Path $data 'tts-cache'))) 'GUI uninstall left cache'
# Remove the sentinel personal data using the tested full-delete path.
Install-Test @('DesktopShortcut=false')
Assert-Test ((Invoke-Fixture $uninstaller @('--verbose', '--script', $uiController, 'UiDeleteAll=true', 'UiNativeNavigation=true')) -eq 0) 'GUI full uninstall via native navigation failed'
Assert-UiLog
Wait-Removed
foreach ($target in @($data, $cache, $unityData, $registry)) {
    Assert-Test (-not (Test-Path -LiteralPath $target)) "GUI full uninstall left $target"
}
Write-Output 'PASS: real Qt installer GUI options, nonzero progress, completion and cancel preserve data'
# Clean only this run's sentinel identities. Program/data cleanup itself was
# performed and verified by the actual generated Qt maintenance tool.
Remove-Item -LiteralPath $devData -Recurse
Remove-Item -LiteralPath $devRegistry
Write-Output "Evidence directory: $work"
} finally {
    # Keep build/log evidence in the workspace, but never leave test identities
    # in the user's profile or Start menu, including after an assertion fails.
    if (Test-Path -LiteralPath $uninstaller) {
        try { $null = Uninstall-Test @('DeleteAll=true'); Wait-Removed } catch { Write-Warning $_ }
    }
    foreach ($target in @($data, $cache, $unityData, $devData, $desktopLink, $startMenu)) {
        $leaf = Split-Path $target -Leaf
        if ($leaf -notin @($name, "$name-updater", "$name-development", $unityProduct, "$product.lnk", $product)) {
            throw 'Unexpected fixture cleanup identity'
        }
        if (Test-Path -LiteralPath $target) {
            if ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked fixture cleanup target' }
            if ((Get-Item -LiteralPath $target).PSIsContainer -and (Get-ChildItem -LiteralPath $target -Recurse -Force -Attributes ReparsePoint)) { throw 'Linked fixture cleanup entry' }
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
    foreach ($key in @($registry, $devRegistry)) {
        if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse }
    }
}
