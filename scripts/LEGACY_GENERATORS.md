# Legacy SQL generators — not a deploy path

The `gen-*.mjs` hotfix generators were moved to:

`supabase/legacy/DO_NOT_RUN/generators/`

Do not run them to provision, repair, or bootstrap a database.
Canonical schema changes go in `supabase/migrations` only.
