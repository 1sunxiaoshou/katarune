param(
    [ValidateSet('true', 'false')][string]$DeleteAll = 'false',
    [ValidateSet('Validate', 'Clean')][string]$Action = 'Clean',
    [Parameter(Mandatory)][string]$DataName,
    [Parameter(Mandatory)][string]$UnityProduct
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $identity = [pscustomobject]@{ dataName = $DataName; unityProduct = $UnityProduct }
    foreach ($name in @($identity.dataName, $identity.unityProduct)) {
        if ([string]::IsNullOrWhiteSpace($name) -or $name -match '[\\/:*?"<>|]' -or $name -in @('.', '..')) {
            throw 'Invalid application identity'
        }
    }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KataruneKnownFolder {
    [DllImport("shell32.dll")]
    private static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);
    public static string LocalLow() {
        Guid id = new Guid("A520A1A4-1780-4FF6-BD18-167343C5AF16");
        IntPtr path;
        int result = SHGetKnownFolderPath(ref id, 0, IntPtr.Zero, out path);
        Marshal.ThrowExceptionForHR(result);
        try { return Marshal.PtrToStringUni(path); }
        finally { Marshal.FreeCoTaskMem(path); }
    }
}
'@
    $roaming = [Environment]::GetFolderPath('ApplicationData')
    $local = [Environment]::GetFolderPath('LocalApplicationData')
    $low = [KataruneKnownFolder]::LocalLow()
    $personal = Join-Path $roaming $identity.dataName
    $targets = @(
        (Join-Path $personal 'tts-cache'),
        (Join-Path $personal 'asset-staging'),
        (Join-Path $local "$($identity.dataName)-updater"),
        (Join-Path $low "Katarune/$($identity.unityProduct)")
    )
    if ($DeleteAll -eq 'true') { $targets += $personal }
    # Verify fixed application-owned targets and reject junctions before any
    # recursive deletion. Do not follow a user-data link outside these roots.
    foreach ($target in $targets) {
        $absolute = [IO.Path]::GetFullPath($target)
        $ancestors = $absolute
        while ($ancestors -and $ancestors -ne [IO.Path]::GetPathRoot($absolute)) {
            if (Test-Path -LiteralPath $ancestors) {
                $item = Get-Item -LiteralPath $ancestors -Force
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked directory: $ancestors" }
            }
            $ancestors = Split-Path $ancestors -Parent
        }
        if (Test-Path -LiteralPath $absolute) {
            $links = Get-ChildItem -LiteralPath $absolute -Recurse -Force -Attributes ReparsePoint
            if ($links) { throw "Linked file or directory: $($links[0].FullName)" }
        }
    }
    foreach ($target in $targets) {
        if ($Action -eq 'Validate') {
            if (Test-Path -LiteralPath $target) {
                # Open existing files without sharing to detect an occupied
                # data directory without changing or deleting its contents.
                foreach ($file in (Get-ChildItem -LiteralPath $target -Recurse -Force -File)) {
                    $probe = [IO.File]::Open($file.FullName, 'Open', 'ReadWrite', 'None')
                    $probe.Dispose()
                }
            }
            continue
        }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        if (Test-Path -LiteralPath $target) { throw "Directory remains: $target" }
    }
    if ($Action -eq 'Validate') { exit 0 }
    $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser', 'Registry64')
    try {
        $registry.DeleteSubKeyTree("Software\Katarune\$($identity.unityProduct)", $false)
        $parent = $registry.OpenSubKey('Software\Katarune')
        if ($parent) {
            $empty = $parent.SubKeyCount -eq 0 -and $parent.ValueCount -eq 0
            $parent.Dispose()
            if ($empty) { $registry.DeleteSubKey('Software\Katarune', $false) }
        }
    } finally { $registry.Dispose() }
    $unityParent = Join-Path $low 'Katarune'
    if ((Test-Path -LiteralPath $unityParent) -and -not (Get-ChildItem -LiteralPath $unityParent -Force)) {
        Remove-Item -LiteralPath $unityParent
    }
    exit 0
} catch {
    Write-Output $_.Exception.Message
    exit 1
}
