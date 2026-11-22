# Install into the desktop profile: copy the package, register the dependency
# and the bundle, and disable the vcc engine it replaces. Idempotent; backs up
# first.
#
# Why a copy instead of a junction: the host only resolves @deepseek-ai/* for
# packages that physically live in the profile. A junction loads but the
# engine silently never activates (verified 2026-11-19 on Windows).
#
# Usage: .\install.ps1            # desktop profile
#        .\install.ps1 -Profile x # another profile name
# Keep this file ASCII-only: PowerShell 5.1 reads BOM-less files as ANSI.

param(
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$userHome = $env:USERPROFILE
if (-not $userHome) { $userHome = $env:HOME }
if (-not $userHome) { throw 'cannot resolve the user home directory' }

$profileDir = Join-Path $userHome ('.dsh\profiles\' + $Profile)
$pkgPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$modDir = Join-Path $profileDir 'node_modules'
$storeDir = Join-Path $profileDir 'local-packages'
$storeCopy = Join-Path $storeDir 'dsh-fish-jiyu'
$target = Join-Path $modDir 'dsh-fish-jiyu'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $pkgPath)) { throw "profile not found: $pkgPath" }

# 1) back up the two files we edit
Copy-Item $pkgPath "$pkgPath.bak-$stamp" -Force
if (Test-Path $patchPath) {
  Copy-Item $patchPath "$patchPath.bak-$stamp" -Force
  Write-Host "backup: package.json.bak-$stamp, cordis.patch.yml.bak-$stamp"
} else {
  Write-Host "backup: package.json.bak-$stamp (no cordis.patch.yml yet)"
}

# 2) keep an own copy inside the profile; the dependency points here, so the
#    folder you downloaded from can be deleted afterwards
if (-not (Test-Path $storeDir)) { New-Item -ItemType Directory -Path $storeDir -Force | Out-Null }
if (-not (Test-Path $storeCopy)) { New-Item -ItemType Directory -Path $storeCopy -Force | Out-Null }
robocopy $here $storeCopy /MIR /NFL /NDL /NJH /NJS /NP /XD node_modules .git | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy to local-packages failed with $LASTEXITCODE" }
Write-Host "stored: $storeCopy"

# 2) copy the package into node_modules as a real directory
if (-not (Test-Path $modDir)) { New-Item -ItemType Directory -Path $modDir -Force | Out-Null }
$existing = Get-Item $target -ErrorAction SilentlyContinue
if ($existing -and $existing.LinkType -in @('SymbolicLink','Junction')) { Remove-Item $target -Recurse -Force }
if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }
$rcArgs = @(
  $here, $target,
  '/MIR', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
  '/XF', '*.bak*', 'loaded.txt', 'load-error.txt', 'index.full.js*',
  '/XD', 'node_modules', '.git'
)
robocopy @rcArgs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE" }
Write-Host "copied: $here -> $target"

# 3) package.json: dependency + bundle entry
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName 'dependencies' -NotePropertyValue ([pscustomobject]@{}) }
$deps = $pkg.dependencies
if (-not ($deps.PSObject.Properties.Name -contains 'dsh-fish-jiyu')) {
  $deps | Add-Member -NotePropertyName 'dsh-fish-jiyu' -NotePropertyValue "link:$($storeCopy -replace '\\','/')"
  Write-Host "dep: dsh-fish-jiyu added"
}
if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName 'dsh' -NotePropertyValue ([pscustomobject]@{}) }
if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName 'profile' -NotePropertyValue ([pscustomobject]@{}) }
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-fish-jiyu') {
  $idx = [array]::IndexOf($bundles, 'dsh-compaction-vcc')
  if ($idx -lt 0) { $bundles += 'dsh-fish-jiyu' }
  else { $bundles = $bundles[0..$idx] + 'dsh-fish-jiyu' + $bundles[($idx + 1)..($bundles.Count - 1)] }
  $pkg.dsh.profile.bundles = $bundles
  Write-Host "bundle: dsh-fish-jiyu added after dsh-compaction-vcc"
}
[System.IO.File]::WriteAllText($pkgPath, ($pkg | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))

# 4) cordis.patch.yml: 只做「关掉别的压缩引擎」。
#    条目由包自带的 bundle 插入；脚本再插一份会重名（DSH 对重复 id 会报冲突）。
#    全新 profile 可能还没有这个文件，没有就跳过。
if (Test-Path $patchPath) {
  $patch = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
  if ($patch.Length -lt 100) { throw "cordis.patch.yml looks empty ($($patch.Length) chars); aborting" }
  $patch = $patch -replace "(?m)^- id: compaction-vcc\r?\n  disabled: false", "- id: compaction-vcc`n  disabled: true"
  [System.IO.File]::WriteAllText($patchPath, $patch, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "patch: existing vcc row disabled (jiyu row comes from the bundle)"
} else {
  Write-Host "patch: no cordis.patch.yml yet; skipped (bundle provides the row)"
}

# 5) a link: dependency makes pnpm rewrite the directory into a symlink the
# next time any plugin is installed. Keep the copy authoritative afterwards.
Write-Host ""
Write-Host "done. Restart DSH to apply."
Write-Host "If you install other plugins later, run sync-to-profile.ps1 (or re-run this script) so this package stays a real directory."
