# Uninstall dsh-fish-jiyu from a DSH profile on Windows.
#
# Reverses install.ps1: re-enables the vcc engine, removes the compaction-jiyu
# patch block, deletes the copied package and cleans package.json.
#
# Usage: .\uninstall.ps1            # desktop profile
#        .\uninstall.ps1 -Profile x # another profile name
# Keep this file ASCII-only: PowerShell 5.1 reads BOM-less files as ANSI.

param(
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'

$userHome = $env:USERPROFILE
if (-not $userHome) { $userHome = $env:HOME }
if (-not $userHome) { throw 'cannot resolve the user home directory' }

$profileDir = Join-Path $userHome ('.dsh\profiles\' + $Profile)
$pkgPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$target = Join-Path $profileDir 'node_modules\dsh-fish-jiyu'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $pkgPath)) { throw "profile not found: $pkgPath" }

Copy-Item $pkgPath "$pkgPath.bak-$stamp" -Force
if (Test-Path $patchPath) {
  Copy-Item $patchPath "$patchPath.bak-$stamp" -Force
  Write-Host "backup: package.json.bak-$stamp, cordis.patch.yml.bak-$stamp"
} else {
  Write-Host "backup: package.json.bak-$stamp (no cordis.patch.yml)"
}

# 1) package.json: drop the dependency and the bundle entry
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($pkg.dependencies) {
  $pkg.dependencies.PSObject.Properties.Remove('dsh-fish-jiyu')
}
if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles) {
  $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-fish-jiyu' })
}
[System.IO.File]::WriteAllText($pkgPath, ($pkg | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "package.json cleaned"

# 2) cordis.patch.yml: turn vcc back on, drop the jiyu block
if (Test-Path $patchPath) {
  $patch = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
  $patch = $patch -replace "(?m)^- id: compaction-vcc\r?\n  disabled: true", "- id: compaction-vcc`n  disabled: false"
  # 只删「从 jiyu 行到下一条顶格 - id: 之前」。不要用 (?s)：那会一路吞到文件尾，
  # 把别的插件配置一起删掉。
  $patch = $patch -replace "(?m)^- id: compaction-jiyu\r?\n(?:[ \t]+.*\r?\n?)*", ""
  [System.IO.File]::WriteAllText($patchPath, $patch, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "patch: compaction-vcc re-enabled, compaction-jiyu removed"
} else {
  Write-Host "patch: no cordis.patch.yml; skipped"
}

# 3) the copied package
if (Test-Path $target) {
  Remove-Item $target -Recurse -Force
  Write-Host "removed: $target"
}

Write-Host ""
Write-Host "done. Restart DSH to apply."
