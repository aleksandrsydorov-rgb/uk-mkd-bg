#!/usr/bin/env node
/**
 * AMADEUS 11 RC8 — portable empty-project DB installer
 *
 * - Secrets only from a closed env file (never git/image).
 * - Strict CONFIRM_PROJECT match against SUPABASE_URL host AND DATABASE_URL user/host.
 * - Password never on psql argv / never logged (PGPASSWORD + -h/-p/-U/-d only).
 * - schema_migrations in Supabase CLI shape (version 14-digit, name slug, statements[]).
 * - Stop on first SQL error; refuse any non-empty / partial target (no blind resume).
 *
 * Usage:
 *   node r1-rc8-db-install.mjs --env-file /etc/amadeus11/rc8-db-install.env \
 *     --confirm-project <ref> [--bundle-root <dir>] [--require-path-psql]
 *   … --verify-only | --preflight-only
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(SCRIPT_DIR, '..');
const FORBIDDEN_PROJECT_REFS = new Set(['klowacuvufknbrkayjhz']);
const EXPECTED_PRIVATE_BUCKETS = [
  'request-photos',
  'chat-files',
  'uk-expense-receipts',
  'poll-images',
  'building-documents',
  'inventory-documents',
];

function fail(code, msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(code);
}

function usage() {
  console.log(`Usage:
  node r1-rc8-db-install.mjs --env-file <path> --confirm-project <ref> [options]

Options:
  --bundle-root <dir>
  --verify-only
  --preflight-only
  --require-path-psql   Refuse PSQL_DOCKER_CONTAINER; use host PATH psql only (VPS path)
  --help`);
}

function parseArgs(argv) {
  const out = {
    envFile: null,
    confirmProject: null,
    bundleRoot: null,
    verifyOnly: false,
    preflightOnly: false,
    requirePathPsql: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--verify-only') out.verifyOnly = true;
    else if (a === '--preflight-only') out.preflightOnly = true;
    else if (a === '--require-path-psql') out.requirePathPsql = true;
    else if (a === '--env-file') out.envFile = argv[++i];
    else if (a === '--confirm-project') out.confirmProject = argv[++i];
    else if (a === '--bundle-root') out.bundleRoot = argv[++i];
    else fail(2, `Unknown argument: ${a}`);
  }
  return out;
}

function loadEnvFile(path) {
  if (!path || !existsSync(path)) fail(2, `Env file not found: ${path || '(missing --env-file)'}`);
  const raw = readFileSync(path, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function resolveBundleRoot(arg) {
  if (arg) return resolve(arg);
  const fromBin = join(SCRIPT_DIR, '..');
  if (existsSync(join(fromBin, 'supabase', 'packages', 'fresh_install', 'MANIFEST.json'))) {
    return fromBin;
  }
  return DEFAULT_REPO_ROOT;
}

function readManifest(bundleRoot) {
  const p = join(bundleRoot, 'supabase', 'packages', 'fresh_install', 'MANIFEST.json');
  if (!existsSync(p)) fail(2, `MANIFEST.json missing at ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function inventory(bundleRoot, manifest) {
  const pkgDir = join(bundleRoot, 'supabase', 'packages', 'fresh_install');
  const migDir = join(bundleRoot, 'supabase', 'migrations');
  const ordered = Array.isArray(manifest.orderedFiles) ? manifest.orderedFiles : [];
  const missingPkg = ordered.filter((f) => !existsSync(join(pkgDir, f)));
  const migFiles = existsSync(migDir)
    ? readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
    : [];
  const expected = Number(manifest.expectedChronologicalMigrationCount);
  return {
    release: manifest.release || null,
    orderedFilesCount: ordered.length,
    ordered,
    missingPkg,
    migrationFiles: migFiles,
    migrationCount: migFiles.length,
    expectedChronologicalMigrationCount: expected,
    countOk: migFiles.length === expected,
    pkgDir,
    migDir,
  };
}

function assertVerify(inv) {
  if (inv.missingPkg.length) fail(2, `Missing package files: ${inv.missingPkg.join(', ')}`);
  if (!inv.countOk) {
    fail(
      2,
      `Migration count ${inv.migrationCount} != MANIFEST.expectedChronologicalMigrationCount ${inv.expectedChronologicalMigrationCount}`,
    );
  }
  if (!inv.release || !String(inv.release).includes('rc8')) {
    fail(2, `Unexpected release in MANIFEST: ${inv.release}`);
  }
  console.log(
    `VERIFY_OK release=${inv.release} package_files=${inv.orderedFilesCount} migrations=${inv.migrationCount}`,
  );
}

function redactUrl(u) {
  try {
    const x = new URL(u);
    if (x.password) x.password = '***';
    return x.toString();
  } catch {
    return '(unparseable)';
  }
}

function parseDbConn(databaseUrl, env) {
  let u;
  try {
    u = new URL(databaseUrl);
  } catch {
    fail(3, 'DATABASE_URL is not a valid URL');
  }
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) {
    fail(3, `DATABASE_URL protocol must be postgresql:// (got ${u.protocol})`);
  }
  const passwordFromUrl = decodeURIComponent(u.password || '');
  const passwordFromEnv = String(env.DATABASE_PASSWORD || '').trim();
  const password = passwordFromEnv || passwordFromUrl;
  if (!password) fail(3, 'Database password missing (DATABASE_URL password or DATABASE_PASSWORD)');
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username || 'postgres'),
    password,
    database: decodeURIComponent((u.pathname || '/postgres').replace(/^\//, '') || 'postgres'),
    sslmode: u.searchParams.get('sslmode') || '',
  };
}

function assertNoSecretInArgv(args) {
  for (const a of args) {
    if (typeof a !== 'string') continue;
    if (/^(postgres|postgresql):\/\//i.test(a)) {
      fail(4, 'Refusing postgresql URI on psql argv — use PGPASSWORD + discrete -h/-p/-U/-d');
    }
    if (a === '--password' || a === '-W') {
      fail(4, 'Refusing psql password flags on argv; use PGPASSWORD instead');
    }
  }
}

/**
 * Strict project-ref binding for cloud:
 * - SUPABASE_URL host === {ref}.supabase.co
 * - DATABASE_URL username is postgres.{ref} OR postgres (direct) with host db.{ref}.supabase.co
 *   OR pooler host containing the ref / user postgres.{ref}
 */
function assertCloudDbRef(confirm, conn) {
  const user = conn.user;
  const host = conn.host.toLowerCase();
  const userOk =
    user === `postgres.${confirm}` ||
    user === confirm ||
    (user === 'postgres' &&
      (host === `db.${confirm}.supabase.co` || host.endsWith(`.${confirm}.supabase.co`)));
  const hostOk =
    host === `db.${confirm}.supabase.co` ||
    host.includes(confirm) ||
    user === `postgres.${confirm}`;
  if (!userOk || !hostOk) {
    fail(
      3,
      `DATABASE_URL does not bind to CONFIRM_PROJECT=${confirm} (user=${user}, host=${host}). Expected user postgres.${confirm} and/or host db.${confirm}.supabase.co / pooler containing the ref.`,
    );
  }
}

function assertTargetProject(env, confirmCli) {
  const confirm = String(confirmCli || '').trim();
  const envConfirm = String(env.CONFIRM_PROJECT || '').trim();
  if (!confirm) fail(3, 'Provide --confirm-project <supabase-project-ref>');
  if (!envConfirm) fail(3, 'Env CONFIRM_PROJECT is required');
  if (confirm !== envConfirm) {
    fail(
      3,
      `Project confirmation mismatch: --confirm-project=${confirm} vs CONFIRM_PROJECT=${envConfirm}`,
    );
  }
  if (FORBIDDEN_PROJECT_REFS.has(confirm)) {
    fail(3, `Refuses forbidden/production project ref: ${confirm}`);
  }

  const supabaseUrl = String(env.SUPABASE_URL || '').trim();
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!supabaseUrl) fail(3, 'Env SUPABASE_URL is required');
  if (!databaseUrl) fail(3, 'Env DATABASE_URL is required');

  let apiHost;
  try {
    apiHost = new URL(supabaseUrl).hostname;
  } catch {
    fail(3, 'SUPABASE_URL is not a valid URL');
  }

  const isLocal = apiHost === '127.0.0.1' || apiHost === 'localhost';
  const conn = parseDbConn(databaseUrl, env);

  if (isLocal) {
    if (String(env.ALLOW_LOCAL_INSTALL || '').toLowerCase() !== 'true') {
      fail(3, 'Local SUPABASE_URL requires ALLOW_LOCAL_INSTALL=true');
    }
    if (conn.host !== '127.0.0.1' && conn.host !== 'localhost') {
      fail(
        3,
        `Local install requires DATABASE_URL host 127.0.0.1/localhost (got ${conn.host})`,
      );
    }
  } else {
    const expectedHost = `${confirm}.supabase.co`;
    if (apiHost !== expectedHost) {
      fail(3, `SUPABASE_URL host ${apiHost} != expected ${expectedHost}`);
    }
    assertCloudDbRef(confirm, conn);
  }

  for (const ref of FORBIDDEN_PROJECT_REFS) {
    if (supabaseUrl.includes(ref) || databaseUrl.includes(ref) || conn.host.includes(ref)) {
      fail(3, `Refuses connection mentioning forbidden ref ${ref}`);
    }
  }

  for (const k of ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!String(env[k] || '').trim()) {
      fail(3, `Env ${k} is required in the closed file`);
    }
  }

  console.log(
    `TARGET_OK confirm=${confirm} supabase_host=${apiHost} db_host=${conn.host} db_user=${conn.user} database=${redactUrl(databaseUrl)}`,
  );
  return { confirm, supabaseUrl, isLocal, conn };
}

function resolvePsqlRunner(env, requirePathPsql) {
  const dockerCtr = String(env.PSQL_DOCKER_CONTAINER || '').trim();
  if (requirePathPsql && dockerCtr) {
    fail(4, '--require-path-psql set: unset PSQL_DOCKER_CONTAINER and use host PATH psql');
  }
  if (dockerCtr && !requirePathPsql) {
    const probe = spawnSync(
      'docker',
      ['exec', dockerCtr, 'psql', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1'],
      { encoding: 'utf8' },
    );
    if (probe.status !== 0) {
      fail(4, `PSQL_DOCKER_CONTAINER=${dockerCtr} is not reachable via docker exec`);
    }
    console.log(`PSQL_VIA=docker:${dockerCtr}`);
    return { mode: 'docker', container: dockerCtr };
  }
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) {
    console.log(`PSQL_VIA=path version=${String(probe.stdout || '').trim()}`);
    return { mode: 'path' };
  }
  fail(4, 'psql not found on PATH. Install PostgreSQL client tools (required on VPS).');
}

function pathPsqlEnv(conn) {
  const env = { ...process.env, PGPASSWORD: conn.password };
  if (conn.sslmode) env.PGSSLMODE = conn.sslmode;
  else if (conn.host !== '127.0.0.1' && conn.host !== 'localhost') env.PGSSLMODE = 'require';
  delete env.DATABASE_URL;
  delete env.DATABASE_PASSWORD;
  return env;
}

function pathPsqlBaseArgs(conn) {
  return ['-h', conn.host, '-p', String(conn.port), '-U', conn.user, '-d', conn.database];
}

function psqlFile(runner, conn, filePath) {
  if (runner.mode === 'docker') {
    const dest = `/tmp/rc8_install_${process.pid}_${Date.now()}.sql`;
    const cp = spawnSync('docker', ['cp', filePath, `${runner.container}:${dest}`], {
      encoding: 'utf8',
    });
    if (cp.status !== 0) {
      return { status: cp.status, stderr: cp.stderr || 'docker cp failed', stdout: cp.stdout };
    }
    const args = [
      'exec',
      runner.container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      dest,
    ];
    assertNoSecretInArgv(args);
    return spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  }
  const args = [
    ...pathPsqlBaseArgs(conn),
    '-v',
    'ON_ERROR_STOP=1',
    '-v',
    'ON_ERROR_ROLLBACK=on',
    '-f',
    filePath,
  ];
  assertNoSecretInArgv(args);
  return spawnSync('psql', args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: pathPsqlEnv(conn),
  });
}

function psqlScalar(runner, conn, sql) {
  let r;
  if (runner.mode === 'docker') {
    const args = [
      'exec',
      runner.container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-c',
      sql,
    ];
    assertNoSecretInArgv(args);
    r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  } else {
    const args = [...pathPsqlBaseArgs(conn), '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql];
    assertNoSecretInArgv(args);
    r = spawnSync('psql', args, {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      env: pathPsqlEnv(conn),
    });
  }
  if (r.status !== 0) {
    fail(5, `psql query failed: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return String(r.stdout || '').trim();
}

function tableExists(runner, conn, schema, name) {
  const n = psqlScalar(
    runner,
    conn,
    `select count(*)::text from information_schema.tables where table_schema='${schema}' and table_name='${name}'`,
  );
  return Number(n) > 0;
}

function safeCount(runner, conn, schema, name) {
  if (!tableExists(runner, conn, schema, name)) return 0;
  return Number(psqlScalar(runner, conn, `select count(*)::text from ${schema}.${name}`));
}

function runPreflight(runner, conn) {
  if (
    !tableExists(runner, conn, 'storage', 'buckets') ||
    !tableExists(runner, conn, 'storage', 'objects')
  ) {
    fail(
      6,
      'Target is not a Supabase storage-capable database (storage.buckets / storage.objects missing).',
    );
  }

  const counts = {
    properties: safeCount(runner, conn, 'public', 'properties'),
    staff: safeCount(runner, conn, 'public', 'staff'),
    capital_repair_ledger: safeCount(runner, conn, 'public', 'capital_repair_ledger'),
    water_ledger: safeCount(runner, conn, 'public', 'water_ledger'),
    electricity_ledger: safeCount(runner, conn, 'public', 'electricity_ledger'),
    schema_migrations: safeCount(runner, conn, 'supabase_migrations', 'schema_migrations'),
  };
  const blockers = Object.entries(counts).filter(([, n]) => Number(n) > 0);
  if (blockers.length) {
    fail(
      6,
      `Target database is not empty / partial install present (refuse write; use a fresh empty project, do not resume): ${blockers
        .map(([k, n]) => `${k}=${n}`)
        .join(', ')}`,
    );
  }

  // Also refuse if package already applied (properties table exists even if empty rows).
  if (tableExists(runner, conn, 'public', 'properties')) {
    fail(
      6,
      'public.properties already exists — refuse partial/prior package apply. Use a brand-new empty Supabase project.',
    );
  }

  console.log(`EMPTY_OK ${JSON.stringify(counts)}`);
  return counts;
}

function ensureMigrationsHistory(runner, conn) {
  const sql = `
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
`;
  const tmp = join(
    process.env.TEMP || process.env.TMPDIR || '/tmp',
    `rc8_schema_migrations_ensure_${process.pid}.sql`,
  );
  writeFileSync(tmp, sql, 'utf8');
  const r = psqlFile(runner, conn, tmp);
  if (r.status !== 0) {
    fail(7, `Failed to ensure schema_migrations: ${(r.stderr || r.stdout || '').trim()}`);
  }
}

function parseMigrationFilename(file) {
  const base = file.replace(/\.sql$/i, '');
  const m = /^(\d{14})_(.+)$/.exec(base);
  if (!m) fail(8, `Migration filename not in Supabase form NNNNNNNNNNNNNN_slug.sql: ${file}`);
  return { version: m[1], name: m[2] };
}

function splitSqlStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  const startsDollar = (s, pos) => {
    if (s[pos] !== '$') return null;
    let j = pos + 1;
    while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
    if (j < s.length && s[j] === '$') return s.slice(pos, j + 1);
    return null;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      buf += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === '*' && next === '/') {
        buf += '/';
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (dollarTag) {
      buf += ch;
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag.slice(1);
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      buf += ch;
      if (ch === "'" && next === "'") {
        buf += next;
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (ch === '-' && next === '-') {
      buf += ch + next;
      i += 2;
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      buf += ch + next;
      i += 2;
      inBlockComment = true;
      continue;
    }
    const tag = startsDollar(sql, i);
    if (tag) {
      buf += tag;
      i += tag.length;
      dollarTag = tag;
      continue;
    }
    if (ch === "'") {
      buf += ch;
      inSingle = true;
      i++;
      continue;
    }
    if (ch === ';') {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

function dollarQuote(tag, body) {
  let t = tag;
  let n = 0;
  while (body.includes(`$${t}$`)) {
    n += 1;
    t = `${tag}${n}`;
  }
  return `$${t}$${body}$${t}$`;
}

function recordMigration(runner, conn, filePath, fileName) {
  const { version, name } = parseMigrationFilename(fileName);
  const sqlText = readFileSync(filePath, 'utf8');
  const statements = splitSqlStatements(sqlText);
  if (!statements.length) {
    fail(8, `Migration ${fileName} produced zero SQL statements for history`);
  }

  // INSERT only — conflict means partial prior install; do not upsert blindly.
  const arraySql = statements.map((s, idx) => dollarQuote(`s${idx}`, s)).join(',\n  ');
  const insertSql = `-- record ${fileName} (Supabase CLI shape; no upsert)
insert into supabase_migrations.schema_migrations (version, name, statements)
values (
  ${dollarQuote('v', version)},
  ${dollarQuote('n', name)},
  ARRAY[
  ${arraySql}
  ]::text[]
);
`;
  const tmp = join(
    process.env.TEMP || process.env.TMPDIR || '/tmp',
    `rc8_mig_hist_${version}_${process.pid}.sql`,
  );
  writeFileSync(tmp, insertSql, 'utf8');
  const r = psqlFile(runner, conn, tmp);
  if (r.status !== 0) {
    fail(
      8,
      `Failed recording schema_migrations for ${version}/${name} (partial history?): ${(r.stderr || r.stdout || '').trim()}`,
    );
  }
}

function postApplyGates(runner, conn, inv) {
  const n = Number(
    psqlScalar(runner, conn, 'select count(*)::text from supabase_migrations.schema_migrations'),
  );
  if (n !== inv.expectedChronologicalMigrationCount) {
    fail(
      11,
      `Post-apply schema_migrations count ${n} != expected ${inv.expectedChronologicalMigrationCount}`,
    );
  }

  const badFmt = psqlScalar(
    runner,
    conn,
    `select coalesce(string_agg(version, ',' order by version), '')
     from supabase_migrations.schema_migrations
     where version !~ '^[0-9]{14}$'
        or name is null or btrim(name) = ''
        or name like '%.sql'
        or name ~ '^[0-9]{14}_'
        or statements is null
        or cardinality(statements) < 1`,
  );
  if (badFmt) fail(11, `schema_migrations rows not in Supabase CLI format: ${badFmt}`);

  const missingVersions = [];
  for (const f of inv.migrationFiles) {
    const { version } = parseMigrationFilename(f);
    const exists = psqlScalar(
      runner,
      conn,
      `select count(*)::text from supabase_migrations.schema_migrations where version='${version}'`,
    );
    if (exists !== '1') missingVersions.push(version);
  }
  if (missingVersions.length) {
    fail(11, `Missing schema_migrations versions: ${missingVersions.slice(0, 10).join(',')}`);
  }

  const bucketN = Number(
    psqlScalar(
      runner,
      conn,
      `select count(*)::text from storage.buckets
       where id in (${EXPECTED_PRIVATE_BUCKETS.map((b) => `'${b}'`).join(',')})
         and public = false`,
    ),
  );
  if (bucketN !== EXPECTED_PRIVATE_BUCKETS.length) {
    fail(11, `Expected ${EXPECTED_PRIVATE_BUCKETS.length} private buckets, found ${bucketN}`);
  }

  const impl = psqlScalar(
    runner,
    conn,
    `select coalesce(
       (select implemented::text from public.module_catalog where module_key='general_meeting'),
       'missing'
     )`,
  );
  const enabled = psqlScalar(
    runner,
    conn,
    `select coalesce(
       (select enabled::text from public.building_modules where module_key='general_meeting' limit 1),
       'false'
     )`,
  );
  if (impl !== 'true' || enabled !== 'false') {
    fail(
      11,
      `Meetings gate FAIL: implemented=${impl} enabled=${enabled} (need implemented=true enabled=false)`,
    );
  }

  const rental = psqlScalar(
    runner,
    conn,
    `select coalesce(
       (select implemented::text from public.module_catalog where module_key='rental'),
       'missing'
     )`,
  );
  if (rental !== 'false') fail(11, `Rental must stay implemented=false (got ${rental})`);

  const emailOn = psqlScalar(
    runner,
    conn,
    `select coalesce(
       (select email_enabled::text from public.complex_email_settings limit 1),
       'false'
     )`,
  );
  if (emailOn !== 'false') fail(11, `Email must stay OFF (email_enabled=${emailOn})`);

  console.log(
    `GATES_OK migrations=${n} private_buckets=${bucketN} meetings=implemented/enabled-ok rental=${rental} email_enabled=${emailOn}`,
  );
}

function applyAll(runner, conn, inv) {
  console.log(`=== Apply fresh_install package (${inv.ordered.length} files) ===`);
  for (const f of inv.ordered) {
    const src = join(inv.pkgDir, f);
    console.log(`  -> package ${f}`);
    const r = psqlFile(runner, conn, src);
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      fail(9, `Package apply stopped at ${f} — do not resume; recreate empty project`);
    }
  }

  ensureMigrationsHistory(runner, conn);

  console.log(`=== Apply chronological migrations (${inv.migrationCount}) ===`);
  for (const f of inv.migrationFiles) {
    const src = join(inv.migDir, f);
    console.log(`  -> migration ${f}`);
    const r = psqlFile(runner, conn, src);
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      fail(10, `Migration apply stopped at ${f} — do not resume; recreate empty project`);
    }
    recordMigration(runner, conn, src, f);
  }

  postApplyGates(runner, conn, inv);
  console.log(
    `APPLY_OK package=${inv.orderedFilesCount} migrations=${inv.migrationCount} release=${inv.release} history=supabase_format`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.verifyOnly && !args.envFile) fail(2, '--env-file is required');
  if (!args.verifyOnly && !args.confirmProject) fail(2, '--confirm-project is required');

  const bundleRoot = resolveBundleRoot(args.bundleRoot);
  const manifest = readManifest(bundleRoot);
  const inv = inventory(bundleRoot, manifest);
  assertVerify(inv);
  if (args.verifyOnly) process.exit(0);

  const envPath = isAbsolute(args.envFile) ? args.envFile : resolve(args.envFile);
  const env = loadEnvFile(envPath);
  const target = assertTargetProject(env, args.confirmProject || env.CONFIRM_PROJECT);
  const runner = resolvePsqlRunner(env, args.requirePathPsql);
  runPreflight(runner, target.conn);

  if (args.preflightOnly) {
    console.log('PREFLIGHT_ONLY_OK (no DDL applied)');
    process.exit(0);
  }

  applyAll(runner, target.conn, inv);
}

main();
