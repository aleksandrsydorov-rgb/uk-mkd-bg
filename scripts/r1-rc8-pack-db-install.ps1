# Build portable RC8 DB install bundle (no secrets). Output under tmp/ (gitignored).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$rel = '1.0.0-rc8'
$outName = "amadeus11-rc8-db-install-$rel"
$stage = Join-Path $root "tmp\$outName"
$zip = Join-Path $root "tmp\$outName.zip"
$evidence = Join-Path $root 'tmp\r1_rc8_db_install_pack_evidence.txt'

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'bin') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'supabase\packages\fresh_install') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'supabase\migrations') | Out-Null

Copy-Item (Join-Path $root 'scripts\r1-rc8-db-install.mjs') (Join-Path $stage 'bin\r1-rc8-db-install.mjs')
Copy-Item (Join-Path $root 'distribution\rc8-db-install\env.example') (Join-Path $stage 'env.example')
Copy-Item (Join-Path $root 'distribution\rc8-db-install\env.docker.r1-rc8-test.example') (Join-Path $stage 'env.docker.r1-rc8-test.example')
Copy-Item (Join-Path $root 'distribution\rc8-db-install\README.md') (Join-Path $stage 'README.md')
Copy-Item (Join-Path $root 'docker-compose.r1-rc8-vps.yml') (Join-Path $stage 'docker-compose.r1-rc8-vps.yml')
Copy-Item (Join-Path $root 'docs\distribution\R1_DIST_RC8_DB_INSTALL.md') (Join-Path $stage 'R1_DIST_RC8_DB_INSTALL.md')
Copy-Item (Join-Path $root 'docs\distribution\R1_DIST_FIRST_BOOT.md') (Join-Path $stage 'R1_DIST_FIRST_BOOT.md')
Copy-Item (Join-Path $root 'supabase\packages\fresh_install\*') (Join-Path $stage 'supabase\packages\fresh_install\') -Recurse
Copy-Item (Join-Path $root 'supabase\migrations\*.sql') (Join-Path $stage 'supabase\migrations\')

$manifest = Get-Content (Join-Path $stage 'supabase\packages\fresh_install\MANIFEST.json') -Raw | ConvertFrom-Json
$migCount = @(Get-ChildItem (Join-Path $stage 'supabase\migrations\*.sql')).Count
$pkgCount = @($manifest.orderedFiles).Count
if ($migCount -ne [int]$manifest.expectedChronologicalMigrationCount) {
  throw "Pack migration count $migCount != expected $($manifest.expectedChronologicalMigrationCount)"
}

if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $stage -DestinationPath $zip -Force
$hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()

$log = @(
  "packed=$(Get-Date -Format o)"
  "stage=$stage"
  "zip=$zip"
  "sha256=$hash"
  "release=$($manifest.release)"
  "package_files=$pkgCount"
  "migrations=$migCount"
  "secrets_included=false"
)
$log | Set-Content $evidence -Encoding utf8
Write-Host ($log -join "`n")
Write-Host "Evidence: $evidence"
