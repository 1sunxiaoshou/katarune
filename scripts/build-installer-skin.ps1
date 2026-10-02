param([switch]$TestUI)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'build/installer-nsis'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio C++ Build Tools and the Windows SDK first.' }
$installation = & $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'Visual Studio x86 C++ tools are required for the NSIS visual extension.' }
$environment = Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
$source = Join-Path $root 'resources/installer/skin.cpp'
$exports = Join-Path $root 'resources/installer/skin.def'
# One shell compiles only repository source. Static CRT keeps the installer standalone.
$testFlag = if ($TestUI) { '/DKATARUNE_SKIN_TEST' } else { '' }
$command = "`"$environment`" -no_logo -arch=x86 -host_arch=x64 && cl /nologo /std:c++17 /utf-8 /EHsc /O2 /MT /DUNICODE /D_UNICODE $testFlag /LD `"$source`" /Fo`"$output/skin.obj`" /link /DEF:`"$exports`" /OUT:`"$output/KataruneSkin.dll`" /IMPLIB:`"$output/skin.lib`" user32.lib gdi32.lib gdiplus.lib shell32.lib ole32.lib comctl32.lib"
& $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw 'NSIS visual extension compilation failed.' }
