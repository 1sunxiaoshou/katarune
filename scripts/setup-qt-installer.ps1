$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $workspace 'build/qt-ifw/4.8.1'
if (Test-Path -LiteralPath (Join-Path $destination 'bin/binarycreator.exe')) {
    Write-Output "Qt IFW ready: $destination"
    exit 0
}
if ($env:QT_IFW_ROOT -and (Test-Path -LiteralPath (Join-Path $env:QT_IFW_ROOT 'bin/binarycreator.exe'))) {
    Write-Output "Using QT_IFW_ROOT: $env:QT_IFW_ROOT"
    exit 0
}
$cache = Join-Path $workspace 'build/qt-ifw'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$sdk = Join-Path $cache 'QtInstallerFramework-4.8.1.exe'
$sha256 = 'B0A7C6816DFAFF7D571C9E5350FC08952F12022BE87A28F6D8D36A78428C6210'
# Hash published by Qt's official mirror list. An SDK is a build dependency,
# not part of the application payload.
$url = 'https://download.qt.io/official_releases/qt-installer-framework/4.8.1/QtInstallerFramework-windows-x64-4.8.1.exe'
if (-not (Test-Path -LiteralPath $sdk)) { Invoke-WebRequest -Uri $url -OutFile $sdk }
if ((Get-FileHash -LiteralPath $sdk -Algorithm SHA256).Hash -ne $sha256) { throw 'Qt IFW SDK checksum mismatch' }
$temporarySdk = Join-Path ([IO.Path]::GetTempPath()) "katarune-qt-ifw-$([guid]::NewGuid().ToString('N'))"
# Use forward slashes for Qt's CLI and an ASCII temporary path for the SDK.
& $sdk --root ($temporarySdk.Replace('\', '/')) --accept-licenses --default-answer --confirm-command install
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $temporarySdk 'bin/binarycreator.exe'))) {
    throw 'Qt IFW setup failed. Install the Qt IFW SDK and set QT_IFW_ROOT to its directory.'
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($directory in @('bin', 'Licenses')) {
    Copy-Item -LiteralPath (Join-Path $temporarySdk $directory) -Destination $destination -Recurse
}
# Let the SDK undo its own files and registration after copying the build tools.
& (Join-Path $temporarySdk 'Uninstaller.exe') --confirm-command purge
if ($LASTEXITCODE -ne 0) { throw "Build tools copied, but SDK staging cleanup failed: $temporarySdk" }
Write-Output "Qt IFW ready: $destination"
