param(
    [Parameter(Mandatory)][string]$TargetDir,
    [Parameter(Mandatory)][string]$Product
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $target = [IO.Path]::GetFullPath($TargetDir).TrimEnd('\', '/')
    if ($target -eq [IO.Path]::GetPathRoot($TargetDir).TrimEnd('\', '/')) { throw '不能安装到磁盘根目录。' }
    $ancestor = $target
    while ($ancestor -and $ancestor -ne [IO.Path]::GetPathRoot($target)) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '请选择普通安装目录。' }
            if (-not $item.PSIsContainer) { throw '请选择安装目录。' }
        }
        $ancestor = Split-Path $ancestor -Parent
    }
    if ((Test-Path -LiteralPath $target) -and (Get-ChildItem -LiteralPath $target -Force)) {
        $identityFile = Join-Path $target '.installer/identity.json'
        if (-not (Test-Path -LiteralPath $identityFile)) { throw '该目录不为空，请选择其他位置。' }
        $identity = Get-Content -LiteralPath $identityFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($identity.engine -ne 'nsis') { throw '请先卸载旧版 Qt 安装，再安装此版本；默认卸载保留个人数据。' }
        if ($identity.product -ne $Product -or -not (Test-Path -LiteralPath (Join-Path $target "Uninstall $Product.exe"))) {
            throw '该目录已有其他安装，请选择其他位置。'
        }
    }
    exit 0
} catch {
    Write-Output $_.Exception.Message
    exit 1
}
