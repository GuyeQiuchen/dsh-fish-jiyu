# Sync jiyu source from the workspace into the profile.
#
# Why a copy exists: the host only resolves @deepseek-ai/* for packages that
# physically live in the profile. A junction into the workspace loads but the
# engine silently never activates (verified 2026-11-19).
#
# Usage: after editing workspace code, run this, then restart DSH.
#   .\sync-to-profile.ps1                 # desktop profile
#   .\sync-to-profile.ps1 -Profile other  # another profile name
#
# Keep this file ASCII-only: PowerShell 5.1 reads BOM-less files as ANSI.

param(
  [string]$Profile = 'desktop'
)

# Source is the directory this script lives in, so the path works on any machine.
$src = $PSScriptRoot
if (-not $src) { $src = Split-Path -Parent $MyInvocation.MyCommand.Path }

$userHome = $env:USERPROFILE
if (-not $userHome) { $userHome = $env:HOME }
if (-not $userHome) { Write-Error 'cannot resolve the user home directory'; exit 1 }

$dst = Join-Path $userHome ('.dsh\profiles\' + $Profile + '\node_modules\dsh-fish-jiyu')

if (-not (Test-Path $src)) { Write-Error "missing source: $src"; exit 1 }

# pnpm rewrites this entry to a symlink whenever any plugin is installed,
# because the profile declares it as "link:". A symlink loads but the engine
# stays dead (no loaded.txt, no compaction). Break it before copying.
$dstItem = Get-Item $dst -ErrorAction SilentlyContinue
if ($dstItem -and $dstItem.LinkType -eq 'SymbolicLink') {
  $dstItem.Delete()
  Write-Output 'broke the symlink pnpm restored'
}
if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }

$rcArgs = @(
  $src, $dst,
  '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
  '/XF', '*.bak*', 'loaded.txt', 'load-error.txt', 'index.full.js*',
  '/XD', 'node_modules'
)
robocopy @rcArgs | Out-Null
$code = $LASTEXITCODE

# robocopy exit codes 0-7 all mean success
if ($code -ge 8) { Write-Error "robocopy failed with $code"; exit $code }

$target = Join-Path $dst 'index.js'
node --check $target
if ($LASTEXITCODE -ne 0) { Write-Error 'index.js failed syntax check; do not restart'; exit 2 }

Write-Output "synced to $dst; restart DSH to apply"
