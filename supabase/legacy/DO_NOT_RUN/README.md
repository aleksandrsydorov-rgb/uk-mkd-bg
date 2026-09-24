# Historical SQL — DO NOT RUN

These files are kept only as history.

- **NEVER execute them** against a live database.
- **NEVER execute them** against a new database or a new complex.
- They may contain obsolete insecure RLS policies, grants, and RPCs.
- Permissive policies combine with OR. Replaying a file after hardening can reopen access.

Canonical production deployment uses **`supabase/migrations` only**.

`NEW COMPLEX = NEW DATABASE`. Fresh-complex provisioning is blocked until a hardened baseline is generated after SH-3. Do not use these scripts as a workaround.

Generators in `generators/` can recreate insecure hotfix SQL. They are not a deploy path.
