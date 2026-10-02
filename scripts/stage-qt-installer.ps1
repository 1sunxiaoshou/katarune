param([Parameter(Mandatory)][string]$Stage, [Parameter(Mandatory)][string]$Payload, [Parameter(Mandatory)][string]$QtRoot)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$buildRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'build')).TrimEnd('\') + '\'
$target = [IO.Path]::GetFullPath($Stage)
if (-not $target.StartsWith($buildRoot, [StringComparison]::OrdinalIgnoreCase) -or $target.TrimEnd('\') -eq $buildRoot.TrimEnd('\')) {
    throw 'Installer stage must be a subdirectory of build/'
}
if (Test-Path -LiteralPath $target) {
    if ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked stage is not allowed' }
    if (Get-ChildItem -LiteralPath $target -Recurse -Force -Attributes ReparsePoint) { throw 'Linked stage entry is not allowed' }
    Remove-Item -LiteralPath $target -Recurse -Force
}
$data = Join-Path $target 'packages/app.katarune.desktop/data'
New-Item -ItemType Directory -Path $data -Force | Out-Null
if (Get-ChildItem -LiteralPath $Payload -Recurse -Force -Attributes ReparsePoint) { throw 'Linked payload is not allowed' }
Get-ChildItem -LiteralPath $Payload -Force | Copy-Item -Destination $data -Recurse -Force
$licenses = Join-Path $QtRoot 'Licenses'
if (Test-Path -LiteralPath $licenses) {
    New-Item -ItemType Directory -Path (Join-Path $data '.installer') -Force | Out-Null
    Copy-Item -LiteralPath $licenses -Destination (Join-Path $data '.installer/Qt-IFW-Licenses') -Recurse
}
