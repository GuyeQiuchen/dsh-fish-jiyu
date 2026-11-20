# 装进 desktop profile：junction + package.json + cordis.patch.yml（全部幂等，先备份）
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$pkgPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$linkPath = Join-Path $profileDir 'node_modules\dsh-fish-jiyu'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $pkgPath)) { throw "profile not found: $pkgPath" }

# 1) 备份
Copy-Item $pkgPath "$pkgPath.bak-$stamp" -Force
Copy-Item $patchPath "$patchPath.bak-$stamp" -Force
Write-Host "backup: package.json.bak-$stamp, cordis.patch.yml.bak-$stamp"

# 2) junction
if (-not (Test-Path $linkPath)) {
  New-Item -ItemType Junction -Path $linkPath -Target $here | Out-Null
  Write-Host "link: $linkPath -> $here"
} else {
  Write-Host "link exists"
}

# 3) package.json：dependencies + dsh.profile.bundles
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$deps = $pkg.dependencies
if (-not ($deps.PSObject.Properties.Name -contains 'dsh-fish-jiyu')) {
  $deps | Add-Member -NotePropertyName 'dsh-fish-jiyu' -NotePropertyValue "link:$($here -replace '\\','/')"
  Write-Host "dep: dsh-fish-jiyu added"
}
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-fish-jiyu') {
  $idx = [array]::IndexOf($bundles, 'dsh-compaction-vcc')
  if ($idx -lt 0) { $bundles += 'dsh-fish-jiyu' } else { $bundles = $bundles[0..$idx] + 'dsh-fish-jiyu' + $bundles[($idx + 1)..($bundles.Count - 1)] }
  $pkg.dsh.profile.bundles = $bundles
  Write-Host "bundle: dsh-fish-jiyu added after dsh-compaction-vcc"
}
$pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8

# 4) cordis.patch.yml：关 vcc（否则两条压缩引擎同时注册会撞车）
$patch = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
if ($patch.Length -lt 100) { throw "cordis.patch.yml looks empty ($($patch.Length) chars); aborting" }
$patch = $patch -replace "(?m)^- id: compaction-vcc\r?\n  disabled: false", "- id: compaction-vcc`n  disabled: true"
if ($patch -notmatch '(?m)^- id: compaction-jiyu') {
  $patch = $patch.TrimEnd() + "`n`n- id: compaction-jiyu`n  config:`n    thresholdRatio: 0.55`n    retainTurns: 1`n    retainTokens: 16384`n"
}
[System.IO.File]::WriteAllText($patchPath, $patch, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "patch: compaction-vcc disabled, compaction-jiyu configured"
Write-Host "done. 重启 DSH 后生效；不想要就运行 uninstall.ps1"
