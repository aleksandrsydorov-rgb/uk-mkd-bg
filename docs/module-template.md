# Module template (future modules)

Use this when promoting a stub (`implemented=false`) to a live module.
Do not create stub UIs in advance.

## 1. Identity

- `module_key`: snake_case, stable forever
- `category`: one of `finance` | `utilities` | `communication` | `documents` | `services` | `commercial`
- `default_name` + i18n keys under `admin.module*` / owner copy

## 2. Catalog

Migration (new file only — never edit applied migrations):

```sql
-- upsert module_catalog row
-- set implemented = true
-- ensure building_modules rows for existing buildings (default enabled or disabled — product call)
```

App:

- add to `BUILDING_MODULE_KEYS` and `IMPLEMENTED_MODULE_KEYS` in `src/lib/modules.ts`
- add `moduleLabelMessageKey` entry + messages (ru/en/bg)

## 3. Gating

- Admin section/nav: `isBuildingModuleEnabled(buildingModules, 'your_key')`
- Owner section/nav: same
- Missing / unknown / false ⇒ disabled (deterministic)

## 4. Billing choice (pick one)

**A) Tariff-backed (recurring)**

- Insert `tariff_catalog` with `tariff_key = module_key`
- Define unit, components (`base` or day/night), `application_basis`
- Resolver RPCs fail closed (no legacy fallback)
- Admin publish via existing Tariff Core UI (`AdminTariffs`)
- Snapshots on charge/assessment if money is finalized

**B) Assessment + ledger (campaign / operator amount)**

- Follow `capital_repair` pattern: assessment + ledger + explicit amounts
- Do **not** add tariff_catalog unless a real periodic rate exists later

**C) No billing**

- Communication/documents style: CRUD + RLS/RPC only

## 5. Surfaces

| Layer | Deliverable |
|-------|-------------|
| Admin | Section or tab, empty states when module off |
| Owner | Account tab/section gated the same way |
| Types | `database.types.ts` for new RPCs/tables |
| Verify | Read-only SQL smoke/verify if finance |

## 6. Out of scope for this template

- Changing Module Core security from UX-only to RPC-enforced (separate package)
- Converting platform services (expenses, work orders) into modules
- Implementing all remaining stubs in one go
