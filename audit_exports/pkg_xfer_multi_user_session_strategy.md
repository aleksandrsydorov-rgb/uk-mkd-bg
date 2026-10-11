# PKG-XFER Multi-User Session Strategy

**Project:** uk-mkd-bg · **Local app:** `http://localhost:3001` · **Supabase TEST:** `klowacuvufknbrkayjhz`  
**Rule:** Real Supabase Auth only. No JWT spoof, no token copy, no service-role impersonation.

---

## Diagnosis summary

| Question | Finding |
|----------|---------|
| Independent Cursor Browser contexts/profiles? | **No.** MCP exposes multiple tabs, one shared storage partition. Cookie/storage CDP APIs are denied; no profile/incognito API. |
| Shared storage vs app Auth bug? | **Primary:** shared cookie jar across all Cursor tabs. Confirmed identical `sb-klowacuvufknbrkayjhz-auth-token` on admin + login tabs. |
| Extra noise | Cursor Browser also holds Auth cookies for **other** Supabase projects (`arkcsvnwuvprrztvlayn`, `tqfrmvbdzlgtegicemwa`). App uses only the env project cookie; clutter does not create multi-user isolation. |
| App Auth defects | Logout did not clear owner module flags / UI prefs; no `SIGNED_OUT` listener. Narrow fixes applied (see report). Access remains Book-only via `list_my_owned_properties` (no `owner_email` fallback). |

**Consequence:** Admin + Owner1 + Owner2 + Owner3 **cannot** be logged in simultaneously inside Cursor Browser.

---

## Recommended strategy (reusable)

### A — Sequential in Cursor Browser (default for agent automation)

Use **one** authenticated role at a time:

1. Logout (UI) → confirm redirect to `/` and no TEST Auth cookie session.  
2. Login as the next identity via normal password form.  
3. Run that role’s checks.  
4. Logout before switching.

Roles (credentials **outside** repo — password manager / local env only):

| Alias | Typical email pattern | Home |
|-------|----------------------|------|
| Admin | TEST staff email | `/admin` |
| Owner1 | `zoomconf0001+test1@gmail.com` | `/account` |
| Owner2 | `zoomconf0001+test2@gmail.com` | `/account` |
| Owner3 | `zoomconf0001+test3@gmail.com` | `/account` |

Never paste passwords or access tokens into chat logs or `audit_exports/`.

### B — Parallel: OS browser profiles (human / external)

For true concurrent sessions:

1. Chrome/Edge **Profile A** → Admin  
2. **Profile B** → Owner1  
3. **Profile C** → Owner2  
4. **Profile D** → Owner3  

Each profile has isolated cookies. Point all at `http://localhost:3001` + TEST Supabase.

### C — Playwright isolated contexts (optional later)

`package.json` has **no** Playwright today. Only add if sequential Cursor + OS profiles are insufficient. Pattern (do not commit secrets):

```ts
// Conceptual — not shipped
const browser = await chromium.launch();
const admin = await browser.newContext();   // isolated cookies
const owner2 = await browser.newContext();
// each context: page.goto → login with env vars
```

Credentials via `process.env` / `.env.local` (gitignored), never hardcoded.

---

## Per-switch checklist

- [ ] Logout completed (SIGNED_OUT)  
- [ ] Login email matches intended alias  
- [ ] `/account` properties = Book list for that user only  
- [ ] Sidebar modules reload after Book access (fail-closed empty until RPC returns)  
- [ ] Former owner: apt absent / ownership actions denied  
- [ ] Direct `/admin` as owner → redirected to `/account`  
- [ ] Direct `/account` as admin-only staff → staff home  

---

## What not to do

- Do not copy `sb-*-auth-token` cookies between users.  
- Do not assume Cursor tabs are isolated.  
- Do not use service role to “act as” an owner.  
- Do not modify apt 99401/99501 Auth users for session testing.
