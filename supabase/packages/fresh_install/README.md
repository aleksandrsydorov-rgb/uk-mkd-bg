# AMADEUS 11 — Fresh-install baseline package (IS-9b)

**Status:** **READY_FOR_ISOLATED_TEST** — packaging complete for a separately authorized empty-environment apply.  
**Do not** claim clean-install **PASS** until that isolated test succeeds.  
**Do not** apply to production `klowacuvufknbrkayjhz` in IS-9b.

## Purpose

Ordered, idempotent DDL + canonical helpers so a **future empty** Supabase can host Property Book, auth, meters/readings/ledgers, Capital Repair, and Tariff Core prerequisites **before** chronological `supabase/migrations/`.

Continues IS-7a / IS-9a; does not restart or duplicate their intent.

## Deterministic execution order (empty project only)

1. Create empty Supabase project (**not** done in IS-9b).
2. Ensure extension `pgcrypto`.
3. Apply `MANIFEST.json` `orderedFiles` in order (preflight first — refuses populated DBs).
4. Installation owner sets first-admin approval via `install_bootstrap_set_approval` (service_role).
5. Authenticated candidate claims admin via `install_bootstrap_claim_first_admin`.
6. Apply `supabase/migrations/` chronologically.
7. Admin publishes tariff versions via Tariffs UI (**no** prices in this package).

| Order | File | Role |
|------:|------|------|
| 00a | `00_preflight_refuse_populated.sql` | Refuse populated production |
| 00 | `00_properties_baseline.sql` | `properties` |
| 05 | `05_auth_staff_helpers.sql` | Empty `staff` + role helpers |
| 10–20 | meter baselines | `water_meters` / `electricity_meters` |
| 40 | `40_property_registry_people.sql` | Book people / absences |
| 45 | `45_property_book_auth_helpers.sql` | BOOK-ONLY `owns_property` + Book RPCs |
| 30 | `30_meter_rls_enable.sql` | Meter RLS (after owns_property) |
| 50 | `50_capital_repair_baseline.sql` | Capital assessments/ledger |
| 60–70 | module + tariff catalog | Metadata only |
| 75 | `75_utilities_readings_ledgers.sql` | Readings + ledgers (no price seeds) |
| 80 | `80_capital_repair_operational_rpcs.sql` | Payment + balance/reporting |
| 85 | `85_tariff_versions_schema.sql` | Versions schema + charge resolver |
| 88 | `88_email_core_baseline.sql` | Email Core outbox/settings/RPCs (EML-5; `email_enabled=false`) |
| 89 | `89_email_notification_policy.sql` | Notification prefs, digest buffer, policy audit (EML-3–5) |
| 90 | `90_first_admin_bootstrap.sql` | Controlled first-admin claim |
| 91–94 | `91`–`94` R1-UI polish | Polls/announcements grants · Cyrillic role repair · Book floor cast · poll_votes owner SELECT |

### Companions (existing installs; **exclude** preflight)

- `20261026120000_is7a_…`
- `20261028120000_is9a_…`
- `20261029120000_is9b_…` (no-op when objects exist; **no** preflight)

## First-administrator bootstrap

1. Create Auth user out-of-band (invite / dashboard) — **no** package passwords.
2. As `service_role`: `select public.install_bootstrap_set_approval('<token>=32 chars', 'install note');`
3. As that Auth user: `select public.install_bootstrap_claim_first_admin('<token>', 'Display Name');`
4. Token hash cleared on success. Second admin cannot use this path.

## What is / is not packaged

| Packaged | Not packaged (admin / later migrations) |
|----------|----------------------------------------|
| Book auth helpers + portal owner_* sync + validate / active_owners | Full ownership-transfer / extract RPC surface (chronological pkg_xfer migrations) |
| Readings + ledgers DDL + RLS | Water/electricity submit operational RPCs |
| Capital payment + IS-8 balance + charge(single) + bulk/year-bulk | — |
| Tariff catalog + empty versions/rates schema | `publish_tariff_version` body (migrations) / published prices |
| First-admin bootstrap protocol | Public self-registration |

## Remaining gaps

See `MANIFEST.json` → `explicitRemainingGaps`. Package remains structurally ready for isolated test; chronological migrations fill publish tariff RPC and full XFER surfaces.

## Safety

- Idempotent CREATE IF NOT EXISTS / conditional policies
- Preflight refuses populated core tables
- No seed of AMADEUS 11 production rows (no apartment/owner/building payloads)
- No default passwords / embedded credentials
- No `DO_NOT_RUN` execution
- Email Core packaged (EML-5): empty outbox, `email_enabled=false`, no Resend secrets
- Email sending OFF · Debt gate OFF (out of scope)
- No Rental Management
