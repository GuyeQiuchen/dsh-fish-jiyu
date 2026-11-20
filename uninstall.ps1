# 回滚：恢复 vcc、移除 compaction-jiyu、删 junction、清理 package.json 条目
$ErrorActionPreference = 'Stop'

$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$pkgPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$linkPath = Join-Path $profileDir 'node_modules\dsh-fish-jiyu'

# 1) package.json：去掉 dep 与 bundle 条目
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($pkg.dependencies.PSObject.Properties.Name -contains 'dsh-fish-jiyu') {
  $pkg.dependencies.PSObject.Properties.Remove('dsh-fish-jiyu')
}
$bundles = @($pkg.dsh.profile.bundles) | Where-Object { $_ -ne 'dsh-fish-jiyu' }
$pkg.dsh.profile.bundles = $bundles
$pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8
Write-Host "package.json cleaned"

# 2) cordis.patch.yml：开回 vcc，删掉 compaction-jiyu 段
$patch = Get-Content $patchPath -Raw -Encoding UTF8
$patch = $patch -replace "(?m)^- id: compaction-vcc\r?\n  disabled: true", "- id: compaction-vcc`n  disabled: false"
$patch = $patch -replace "(?ms)\r?\n- id: compaction-jiyu\r?\n(?:  .*\r?\n?)*", "`n"
Set-Content $patchPath $patch -Encoding UTF8
Write-Host "patch: vcc re-enabled, compaction-jiyu removed"

# 3) junction
if (Test-Path $linkPath) {
  (Get-Item $linkPath).Delete()
  Write-Host "link removed"
}

Write-Host "done. 重启 DSH 后恢复 vcc。"
