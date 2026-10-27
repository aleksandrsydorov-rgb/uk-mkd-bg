# Build RC8 app image for TEST complex rkiahcmemyocoyznfohc / check.amadeus11.online.
# Reads PUBLIC build-args from a closed host file (never commit).
# Default closed path: %USERPROFILE%\.amadeus11\rc8-test-build.env
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = if ($env:RC8_TEST_BUILD_ENV) { $env:RC8_TEST_BUILD_ENV } else {
  Join-Path $env:USERPROFILE '.amadeus11\rc8-test-build.env'
}
if (-not (Test-Path $envFile)) {
  throw @"
Missing closed build env: $envFile

Create it (chmod/ACL private) with:
  NEXT_PUBLIC_SUPABASE_URL=https://rkiahcmemyocoyznfohc.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon from Supabase Dashboard → Settings → API>
  NEXT_PUBLIC_SITE_URL=https://check.amadeus11.online

Do not put service_role / DB password in this file.
"@
}

Get-Content $envFile | ForEach-Object {
  $t = $_.Trim()
  if (-not $t -or $t.StartsWith('#')) { return }
  $i = $t.IndexOf('=')
  if ($i -lt 1) { return }
  $k = $t.Substring(0, $i).Trim()
  $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
  Set-Item -Path "Env:$k" -Value $v
}

foreach ($req in @('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SITE_URL')) {
  $val = [Environment]::GetEnvironmentVariable($req)
  if ([string]::IsNullOrWhiteSpace($val)) { throw "Missing $req in $envFile" }
}
if ($env:NEXT_PUBLIC_SUPABASE_URL -notmatch 'rkiahcmemyocoyznfohc') {
  throw "NEXT_PUBLIC_SUPABASE_URL must target rkiahcmemyocoyznfohc"
}
if ($env:NEXT_PUBLIC_SITE_URL -notmatch 'check\.amadeus11\.online') {
  throw "NEXT_PUBLIC_SITE_URL must be https://check.amadeus11.online"
}

$outDir = Join-Path $root 'tmp\r1_rc8_transfer'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$tag = 'amadeus11-app:1.0.0-rc8'
$tar = Join-Path $outDir 'amadeus11-app-1.0.0-rc8.tar'

Push-Location $root
try {
  docker build -t $tag `
    --build-arg "NEXT_PUBLIC_SUPABASE_URL=$env:NEXT_PUBLIC_SUPABASE_URL" `
    --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=$env:NEXT_PUBLIC_SUPABASE_ANON_KEY" `
    --build-arg "NEXT_PUBLIC_SITE_URL=$env:NEXT_PUBLIC_SITE_URL" `
    .
  if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
  docker save $tag -o $tar
  $hash = (Get-FileHash -Algorithm SHA256 $tar).Hash.ToLowerInvariant()
  Set-Content -Path ($tar + '.sha256') -Value "$hash  amadeus11-app-1.0.0-rc8.tar" -Encoding ascii
  Write-Host "IMAGE=$tag"
  Write-Host "TAR=$tar"
  Write-Host "SHA256=$hash"
} finally {
  Pop-Location
}
