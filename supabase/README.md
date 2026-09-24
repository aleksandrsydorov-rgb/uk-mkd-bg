# Supabase

## Production deploy

Apply only files in `migrations/`.

```text
supabase db push
```

Do not run SQL from `legacy/DO_NOT_RUN/`.
Do not paste standalone hotfix or bootstrap scripts into the SQL Editor.

Inspect-only scripts (`*_verify.sql` and the listed diagnostic files) stay in this directory. They are not a deploy path.

## Fresh database / new complex — BLOCKED

`NEW COMPLEX = NEW DATABASE`.

`migrations/` currently contains incremental hardening only. There is no complete baseline schema here.

A second complex must not be provisioned from legacy SQL.

Fresh-complex provisioning is blocked until a hardened baseline is generated after SH-3.
