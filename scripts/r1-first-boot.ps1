# R1-FIRST-BOOT — PowerShell wrapper for installer CLI (Docker-compatible).
# Does NOT embed secrets. Load them from a local env file or the process environment.
#
# Invitation delivery uses Supabase Auth SMTP (not AMADEUS Email Core).
# Invitation URLs are never printed or written to disk.
#
# Example (disposable local):
#   $env:SUPABASE_URL = 'http://127.0.0.1:55021'
#   $env:SUPABASE_SERVICE_ROLE_KEY = '<local service_role>'
#   $env:FIRST_BOOT_CONFIRM_PROJECT = 'amadeus11-r1fb-local'
#   .\scripts\r1-first-boot.ps1 smtp-preflight -BaseUrl 'http://127.0.0.1:3085'
#   .\scripts\r1-first-boot.ps1 status
#   .\scripts\r1-first-boot.ps1 provision -Email 'admin@local.dev' -BaseUrl 'http://127.0.0.1:3085' -ConfirmProject 'amadeus11-r1fb-local'
#   .\scripts\r1-first-boot.ps1 resend -BaseUrl 'http://127.0.0.1:3085'
#
# Cloud installs also need:
#   $env:FIRST_BOOT_ALLOW_REMOTE = '1'
#   $env:SUPABASE_ACCESS_TOKEN = '<personal access token with auth_config_read>'

param(
  [Parameter(Position = 0)]
  [ValidateSet('status', 'smtp-preflight', 'provision', 'resend', 'help')]
  [string]$Command = 'help',

  [string]$Email = '',
  [string]$BaseUrl = '',
  [string]$ConfirmProject = '',
  [string]$DisplayName = 'Administrator',
  [string]$TokenFile = '',
  [string]$EnvFile = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

if ($EnvFile) {
  if (-not (Test-Path $EnvFile)) { throw "EnvFile not found: $EnvFile" }
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^=]+)=(.*)$') {
      $k = $Matches[1].Trim()
      $v = $Matches[2].Trim().Trim('"').Trim("'")
      Set-Item -Path "Env:$k" -Value $v
    }
  }
}

$nodeArgs = @('scripts/r1-first-boot.mjs', $Command)
if ($Command -eq 'smtp-preflight') {
  if ($BaseUrl) { $nodeArgs += @('--base-url', $BaseUrl) }
  if ($ConfirmProject) { $nodeArgs += @('--confirm-project', $ConfirmProject) }
}
elseif ($Command -eq 'provision') {
  if (-not $Email -or -not $BaseUrl -or -not $ConfirmProject) {
    throw 'provision requires -Email, -BaseUrl, -ConfirmProject'
  }
  $nodeArgs += @('--email', $Email, '--base-url', $BaseUrl, '--confirm-project', $ConfirmProject, '--display-name', $DisplayName)
  if ($TokenFile) { $nodeArgs += @('--token-file', $TokenFile) }
}
elseif ($Command -eq 'resend') {
  if (-not $BaseUrl) { throw 'resend requires -BaseUrl' }
  $nodeArgs += @('--base-url', $BaseUrl)
  if ($TokenFile) { $nodeArgs += @('--token-file', $TokenFile) }
}

Write-Host "TARGET_URL=$($env:SUPABASE_URL)"
Write-Host "CONFIRM=$($env:FIRST_BOOT_CONFIRM_PROJECT)"
& node @nodeArgs
exit $LASTEXITCODE
