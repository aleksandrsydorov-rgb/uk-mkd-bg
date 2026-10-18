# R1-DIST-1 — disposable empty Postgres clean-install proof.
# Does NOT touch supabase_db_amadeus11-is10a-local or cloud.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pkg = Join-Path $root 'supabase\packages\fresh_install'
$mig = Join-Path $root 'supabase\migrations'
$boot = Join-Path $root 'tmp\r1dist1_clean_pg_bootstrap.sql'
$manifest = Get-Content (Join-Path $pkg 'MANIFEST.json') -Raw | ConvertFrom-Json
$cname = 'amadeus11-r1dist1-clean-db'
$port = 54432
$evidence = Join-Path $root 'tmp\r1dist1_clean_install_evidence.txt'

Write-Host "=== R1-DIST-1 disposable clean DB on port $port ==="
Write-Host "Preserving existing supabase_db_amadeus11-is10a-local (not modified)."

docker rm -f $cname 2>$null | Out-Null
docker run -d --name $cname `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_DB=postgres `
  -p "${port}:5432" `
  postgres:17-alpine | Out-Null

Write-Host "Waiting for Postgres..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  docker exec $cname pg_isready -U postgres 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw "Postgres not ready" }

docker cp $boot "${cname}:/tmp/boot.sql" | Out-Null
docker exec $cname psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/boot.sql | Out-Null

$log = New-Object System.Collections.Generic.List[string]
$log.Add("started=$(Get-Date -Format o)")
$log.Add("container=$cname port=$port")

Write-Host "=== Apply fresh_install package ($($manifest.orderedFiles.Count) files) ==="
foreach ($f in $manifest.orderedFiles) {
  $src = Join-Path $pkg $f
  if (-not (Test-Path $src)) { throw "Missing $f" }
  Write-Host "  -> $f"
  docker cp $src "${cname}:/tmp/fi_$f" | Out-Null
  cmd /c "docker exec $cname psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/fi_$f >nul 2>nul"
  if ($LASTEXITCODE -ne 0) {
    $err = cmd /c "docker exec $cname psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/fi_$f 2>&1"
    $log.Add("FAIL package $f")
    $log.Add(($err | Out-String))
    $log | Set-Content $evidence -Encoding utf8
    throw "Package failed at $f"
  }
  $log.Add("OK package $f")
}

Write-Host "=== Apply chronological migrations ==="
$migs = Get-ChildItem $mig -Filter '*.sql' | Sort-Object Name
$applied = 0
foreach ($m in $migs) {
  Write-Host "  -> $($m.Name)"
  docker cp $m.FullName "${cname}:/tmp/mig_$($m.Name)" | Out-Null
  cmd /c "docker exec $cname psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/mig_$($m.Name) >nul 2>nul"
  if ($LASTEXITCODE -ne 0) {
    $err = cmd /c "docker exec $cname psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/mig_$($m.Name) 2>&1"
    $log.Add("FAIL migration $($m.Name)")
    $log.Add(($err | Out-String))
    $log | Set-Content $evidence -Encoding utf8
    throw "Migration failed at $($m.Name)"
  }
  $applied++
  $log.Add("OK migration $($m.Name)")
}

$verifySql = @"
select json_build_object(
  'properties', (select count(*) from public.properties),
  'staff', (select count(*) from public.staff),
  'gm_implemented', (select implemented from public.module_catalog where module_key='general_meeting'),
  'rental_implemented', (select implemented from public.module_catalog where module_key='rental'),
  'gm_enabled', (select enabled from public.building_modules where module_key='general_meeting'),
  'email_enabled', (select email_enabled from public.complex_email_settings limit 1),
  'poll_votes_owner_policy', exists(select 1 from pg_policies where tablename='poll_votes' and policyname='poll_votes_owner_select'),
  'rls_properties', (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='properties'),
  'mig_count', $applied
);
"@
$verifySqlPath = Join-Path $root 'tmp\r1dist1_verify.sql'
Set-Content -Path $verifySqlPath -Value $verifySql -Encoding ascii
docker cp $verifySqlPath "${cname}:/tmp/verify.sql" | Out-Null
$verify = docker exec $cname psql -U postgres -d postgres -t -A -f /tmp/verify.sql
$log.Add("VERIFY=$verify")
$log.Add("finished=$(Get-Date -Format o)")
$log | Set-Content $evidence -Encoding utf8
Write-Host "VERIFY=$verify"
Write-Host "Evidence: $evidence"
Write-Host "Disposable container left running: $cname (docker rm -f $cname when done)"
