# AMADEUS 11 — Docker application (R1.0 RC)

## Architecture

- **One** Next.js application container (`output: 'standalone'`).
- Supabase (Postgres, Auth, Storage, API) is **external** — not composed into the app stack.
- Local RC: app → isolated local Supabase (`amadeus11-is10a-local` or a future per-complex project).
- Future VPS: one app container + one Supabase project per complex.

## Build

```bash
# Fill .env.docker from .env.docker.example
docker compose --env-file .env.docker build
```

`NEXT_PUBLIC_*` are **build-args**. Changing public Supabase URL/anon key requires an image rebuild.

**RC7 packaging rule:** There is **no** single universal image that works with arbitrary Supabase projects. Build one image per installation (public URL + anon key + site URL). Runtime `SUPABASE_*` secrets remain in the host env file only.

## Run

```bash
docker compose --env-file .env.docker up -d
curl -fsS http://127.0.0.1:3080/api/health
```

Server-side `SUPABASE_URL` should use `http://host.docker.internal:54321` when Supabase is published on the host. Browser uses `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`.

## Runtime properties

| Property | Value |
|----------|--------|
| User | non-root `nextjs` (uid 1001) |
| Port | 3000 in-container |
| Health | `GET /api/health` |
| Restart | `unless-stopped` |
| Migrations on boot | **None** |
| Email sending default | OFF |

## Mandatory variables

Missing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` → build fails (ARG check) or health returns 503.

Service role and Resend secrets are optional at boot; worker routes fail closed without them.
