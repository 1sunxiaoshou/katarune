# Actual electron-builder/NSIS engine with unique disposable identities.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$product = "KataruneNsisTest-$runId"
$dataName = "katarune-nsis-test-$runId"
$unityProduct = "Katarune Avatar Test $runId"
$work = Join-Path $root ".test-dist/nsis-uninstall-$runId"
$fixture = Join-Path $work 'payload'
$installed = Join-Path $work '安装目录 with spaces'
$output = Join-Path $work 'output'
$installer = Join-Path $output "$product-Setup-0.1.0.exe"
$uninstaller = Join-Path $installed "Uninstall $product.exe"
$data = Join-Path $env:APPDATA $dataName
$cache = Join-Path $env:LOCALAPPDATA "$dataName-updater"
$unityData = Join-Path ([Environment]::GetFolderPath('UserProfile')) "AppData/LocalLow/Katarune/$unityProduct"
$devData = "$data-development"
$registry = "HKCU:\Software\Katarune\$unityProduct"
$devRegistry = "$registry Development"
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) "$product.lnk"
$menuLink = Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk"
$uninstallKey = $null
$installKey = $null

function Assert-Test($condition, $message) { if (-not $condition) { throw $message } }
function Write-Fixture($path, $value = 'Disposable installer fixture. Never execute.') {
    New-Item -ItemType Directory -Force (Split-Path $path -Parent) | Out-Null
    Set-Content -LiteralPath $path -Value $value -Encoding utf8
}
function Invoke-Fixture([string]$file, [string[]]$arguments) {
    $runner = @'
const { spawnSync } = require("node:child_process");
const [file, ...args] = process.argv.slice(1);
// NSIS /D= and _?= must be last and unquoted, including paths with spaces.
const result = spawnSync(file, args, { stdio: "inherit", windowsHide: !process.env.KATARUNE_TEST_UI_TRACE, windowsVerbatimArguments: true, timeout: 45000 });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
'@
    & node -e $runner $file @arguments
    return $LASTEXITCODE
}
function Build-Fixture {
    & node scripts/build-nsis-installer.mjs "--payload=$fixture" "--product=$product" "--data-name=$dataName" "--unity-product=$unityProduct" "--output=$output" "--stage=$work/stage" --ui-test=true
    Assert-Test ($LASTEXITCODE -eq 0) 'NSIS fixture build failed'
}
function Install-Test([string[]]$options = @()) {
    Assert-Test ((Invoke-Fixture $installer (@('/S') + $options + @("/D=$installed"))) -eq 0) 'NSIS installation failed'
    Assert-Test (Test-Path -LiteralPath $uninstaller) 'Uninstaller missing'
}
function Uninstall-Test([string[]]$options = @()) {
    # NSIS's default parent exits after spawning a temporary uninstaller. Copy
    # it ourselves and use _?= to wait for the actual removal and its exit code.
    $runner = Join-Path $work 'uninstall-runner.exe'
    Copy-Item -LiteralPath $uninstaller -Destination $runner -Force
    return Invoke-Fixture $runner (@('/S') + $options + @("_?=$installed"))
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
function Invoke-Gui([string]$file, [string]$mode, [string]$selection) {
    $env:KATARUNE_TEST_UI_TRACE = Join-Path $work "gui-$mode.jsonl"
    $env:KATARUNE_TEST_UI_TARGET = $installed
    $env:KATARUNE_TEST_UI_CHOICE = $selection
    try {
        if ($mode -eq 'uninstall') {
            $guiRunner = Join-Path $work 'gui-uninstall-runner.exe'
            Copy-Item -LiteralPath $file -Destination $guiRunner -Force
            $result = Invoke-Fixture $guiRunner @("_?=$installed")
        } else {
            $result = Invoke-Fixture $file @()
        }
        Assert-Test ($result -eq 0) "GUI $mode failed: $result"
        $events = @(Get-Content -LiteralPath $env:KATARUNE_TEST_UI_TRACE | ForEach-Object { $_ | ConvertFrom-Json })
        $phases = @($events | Where-Object event -eq 'page' | ForEach-Object page)
        $expected = if ($mode -eq 'install') { @(0, 1, 2) } else { @(3, 4, 5) }
        foreach ($phase in $expected) { Assert-Test ($phase -in $phases) "Missing GUI phase $phase" }
        $busyPage = if ($mode -eq 'install') { 1 } else { 4 }
        $samples = @($events | Where-Object { $_.page -eq $busyPage -and $_.event -in @('phase-update', 'progress-update') })
        Assert-Test ($samples.Count -gt 0) 'No actual worker progress samples'
        $previous = 0
        foreach ($sample in $samples) {
            Assert-Test ($sample.percent -ge $previous -and $sample.percent -lt 100) 'Progress regressed or reported completion before the worker finished'
            $previous = $sample.percent
        }
        $finishPage = if ($mode -eq 'install') { 2 } else { 5 }
        Assert-Test (@($events | Where-Object { $_.event -eq 'page' -and $_.page -eq $finishPage -and $_.percent -eq 100 }).Count -gt 0) 'Completion did not report 100 percent'
        if ($mode -eq 'install') {
            Assert-Test (@($events | Where-Object event -eq 'extraction-detail').Count -gt 0) 'Actual 7z byte details were not displayed'
        } else {
            Assert-Test (@($events | Where-Object event -eq 'log-update').Count -gt 0) 'Actual uninstall details were not displayed'
        }
        Assert-Test (-not ($events | Where-Object { $_.caption -or -not $_.rounded -or $_.multiline })) 'Window style, region or single-line input validation failed'
        $repaints = @($events | Where-Object { $_.event -eq 'paint' -and $_.page -in @(1, 2, 4, 5) })
        Assert-Test ($repaints.Count -gt 0) 'GUI transition painting was not observed'
        Assert-Test (-not ($repaints | Where-Object { $_.x -lt 530 -or $_.y -lt 343 -or ($_.x + $_.width) -gt 904 -or ($_.y + $_.height) -gt 534 })) 'GUI transition or progress repainted outside the right content area'
        $events | Where-Object event -eq 'paint' | Format-Table page,x,y,width,height | Out-String | Write-Output
    } finally {
        Remove-Item Env:KATARUNE_TEST_UI_TRACE, Env:KATARUNE_TEST_UI_TARGET, Env:KATARUNE_TEST_UI_CHOICE -ErrorAction SilentlyContinue
    }
}
try {
    Write-Fixture (Join-Path $fixture "$product.exe")
    Write-Fixture (Join-Path $fixture 'resources/fixture.txt')
    # A compressible payload makes extraction last long enough to observe the
    # real plugin's byte details; a tiny text fixture skips that entire window.
    $progressPayload = [IO.File]::Create((Join-Path $fixture 'resources/progress-fixture.bin'))
    try {
        $block = [byte[]]::new(1MB)
        for ($index = 0; $index -lt 128; $index++) { $progressPayload.Write($block, 0, $block.Length) }
    } finally { $progressPayload.Dispose() }
    Write-Fixture (Join-Path $fixture 'obsolete.txt')
    Write-Fixture (Join-Path $devData 'development.txt')
    New-Item -Path $devRegistry -Force | Out-Null
    Set-ItemProperty -LiteralPath $devRegistry -Name 'test' -Value 'development fixture'
    Build-Fixture
    Install-Test
    Assert-Test (Test-Path -LiteralPath $desktopLink) 'Desktop shortcut missing'
    Assert-Test (Test-Path -LiteralPath $menuLink) 'Start menu shortcut missing'
    $entries = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Where-Object { (Get-ItemProperty -LiteralPath $_.PSPath).DisplayName -eq $product })
    Assert-Test ($entries.Count -eq 1) 'Unexpected test uninstall registry identity'
    $uninstallKey = $entries[0].PSPath
    $installKey = "HKCU:\Software\$($entries[0].PSChildName)"
    Seed-Data
    Remove-Item -LiteralPath (Join-Path $fixture 'obsolete.txt')
    Build-Fixture
    Install-Test
    foreach ($path in @((Join-Path $data 'personal.txt'), (Join-Path $data 'tts-cache/cache.txt'), (Join-Path $cache 'download.txt'), (Join-Path $unityData 'Player.log'), $registry)) {
        Assert-Test (Test-Path -LiteralPath $path) "Update deleted $path"
    }
    Assert-Test (-not (Test-Path (Join-Path $installed 'obsolete.txt'))) 'Update retained obsolete program file'
    Write-Output 'PASS: update keeps personal/cache/Unity data and removes obsolete program files'

    Assert-Test ((Uninstall-Test) -eq 0) 'Default uninstall failed'
    Assert-Test (-not (Test-Path -LiteralPath $installed)) 'Program directory remains'
    Assert-Test (-not (Test-Path -LiteralPath $desktopLink)) 'Desktop shortcut remains'
    Assert-Test (-not (Test-Path -LiteralPath $menuLink)) 'Start menu shortcut remains'
    Assert-Test (Test-Path (Join-Path $data 'personal.txt')) 'Default uninstall deleted personal data'
    foreach ($path in @((Join-Path $data 'tts-cache'), (Join-Path $data 'asset-staging'), $cache, $unityData, $registry)) {
        Assert-Test (-not (Test-Path -LiteralPath $path)) "Default uninstall left $path"
    }
    Write-Output 'PASS: default uninstall removes program, shortcuts, caches and Unity state; keeps personal data'

    Install-Test @('--no-desktop-shortcut')
    Assert-Test (-not (Test-Path -LiteralPath $desktopLink)) 'Disabled desktop shortcut was created'
    Seed-Data
    $locked = [IO.File]::Open((Join-Path $data 'personal.txt'), 'Open', 'Read', 'None')
    try {
        Assert-Test ((Uninstall-Test @('--delete-all-data')) -ne 0) 'Locked cleanup incorrectly succeeded'
        Assert-Test (Test-Path -LiteralPath $uninstaller) 'Failed cleanup removed uninstaller'
        Assert-Test (Test-Path (Join-Path $installed "$product.exe")) 'Failed cleanup removed program'
        Assert-Test (Test-Path (Join-Path $data 'tts-cache/cache.txt')) 'Failed validation deleted cache'
    } finally { $locked.Dispose() }
    Write-Output 'PASS: locked data prevents removal and retains program/uninstaller for retry'
    Assert-Test ((Uninstall-Test @('--delete-all-data')) -eq 0) 'Full uninstall failed'
    foreach ($path in @($data, $cache, $unityData, $registry, $installed, $uninstallKey, $installKey)) {
        Assert-Test (-not (Test-Path -LiteralPath $path)) "Full uninstall left $path"
    }
    Assert-Test (Test-Path (Join-Path $devData 'development.txt')) 'Development data was removed'
    Assert-Test (Test-Path -LiteralPath $devRegistry) 'Sibling Unity settings were removed'
    Write-Output 'PASS: full uninstall removes release data and retains development data/settings'
    Invoke-Gui $installer 'install' '0'
    Assert-Test (Test-Path -LiteralPath $uninstaller) 'GUI install failed to preserve selected target'
    Assert-Test (-not (Test-Path -LiteralPath $desktopLink)) 'GUI unchecked shortcut was created'
    Seed-Data
    Invoke-Gui $uninstaller 'uninstall' '1'
    # The copied uninstaller waits for the actual worker, including completion.
    $deadline = (Get-Date).AddSeconds(10)
    while ((Test-Path -LiteralPath $installed) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    foreach ($path in @($data, $cache, $unityData, $registry, $installed)) { Assert-Test (-not (Test-Path -LiteralPath $path)) "GUI full removal left $path" }
    Write-Output 'PASS: native GUI install/progress/completion and uninstall/progress/completion, chosen path and checkbox choices'
    Write-Output "Evidence directory: $work"
} finally {
    if (Test-Path -LiteralPath $uninstaller) { $null = Uninstall-Test @('--delete-all-data') }
    foreach ($path in @($data, $cache, $unityData, $devData, $desktopLink, $menuLink)) {
        $absolute = [IO.Path]::GetFullPath($path)
        $leaf = Split-Path $absolute -Leaf
        if ($leaf -notin @($dataName, "$dataName-updater", "$dataName-development", $unityProduct, "$product.lnk")) { throw 'Unexpected fixture cleanup identity' }
        if (Test-Path -LiteralPath $absolute) {
            $item = Get-Item -LiteralPath $absolute -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked fixture cleanup target' }
            if ($item.PSIsContainer -and (Get-ChildItem -LiteralPath $absolute -Recurse -Force -Attributes ReparsePoint)) { throw 'Linked fixture cleanup entry' }
            Remove-Item -LiteralPath $absolute -Recurse -Force
        }
    }
    foreach ($key in @($registry, $devRegistry)) {
        if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse }
    }
}
