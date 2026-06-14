# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Antri is

A job-search tracker: a dependency-free static web app (HTML/CSS/JS) backed by Supabase
(Postgres + Auth), with a small Python backend used only for job-posting extraction.
Live at https://antri.xyz, hosted on Render, data in Supabase.

## Commands

There is **no build step, no linter, and no test framework** — the frontend is plain
static files and the backend is Python standard library only. Don't look for `package.json`,
`npm`, `pytest`, etc.; they don't exist. Edit files and reload.

Run everything (static site + extraction API) from one Python process:

```powershell
$env:OPENAI_API_KEY="your_api_key_here"   # optional; enables AI extraction
python server.py
# marketing home:  http://127.0.0.1:4173/
# app / tracker:   http://127.0.0.1:4173/app.html
```

Server env vars (see top of `server.py`): `HOST` (default `0.0.0.0`), `PORT` (default `4173`),
`ANTRI_OPENAI_MODEL` (default `gpt-4o-mini`), `ANTRI_CANONICAL_HOST` (default `antri.xyz`),
`OPENAI_API_KEY` (omit to fall back to local heuristic parsing).

Supabase setup: put the project URL + **public anon key** in `auth-config.js`
(`window.ANTRI_SUPABASE_CONFIG`), then run `supabase/job_applications.sql` in the Supabase
SQL Editor. Never put a service-role key in `auth-config.js` — it is browser-loaded.

Chrome extension: load `extension/` unpacked via `chrome://extensions` → Developer mode →
Load unpacked.

## Architecture (the non-obvious parts)

**Marketing site vs. the app — two separate front doors.**
- `index.html` is the public **marketing home** (dark-premium landing page), and `pricing.html`
  is the pricing page. Both share `site.css` + `site.js` (the scroll-glow dot field, reveal
  animations, sticky nav, and the scroll-linked "ant trail"). They are static and have no auth.
- The actual product (auth gate + tracker workspace) lives at **`app.html`** and uses
  `styles.css` + `app.js`. "Launch app" links and the extension point here.
- **Backward-compat redirect:** older published extensions open `/index.html?draft=...`. An inline
  script at the top of `index.html` detects a `draft` param and `replace()`s to `app.html`
  (preserving the query), so old installs keep working. New extension builds open `/app.html`
  directly (`extension/popup.js`).

**Two independent backends — data does NOT flow through Python.**
- Persistence and auth: `app.js` calls the **Supabase REST API directly from the browser**
  (`cloudRequest()` → `{SUPABASE_URL}/rest/v1/job_applications`, with the anon key plus the
  signed-in user's JWT). Auth is likewise direct REST via `auth-client.js`/`initializeAuth()`
  — no Supabase SDK, no CDN dependency.
- `server.py` is only an extraction service plus the static file host. It never sees
  application data.

**`server.py` is dual-purpose.** It subclasses `SimpleHTTPRequestHandler` to serve the static
files AND exposes two JSON endpoints: `POST /api/extract-job` (Smart Add from a URL) and
`POST /api/extract-page` (rendered page text from the extension). It also redirects the Render
origin to the canonical host (`redirect_to_canonical_host`).

**Smart Add extraction pipeline** (in `server.py`): ATS adapters first — Greenhouse and Lever
public posting APIs — then a generic page fetch (`VisibleTextParser` strips scripts/styles),
then OpenAI structured output against `JOB_SCHEMA` when `OPENAI_API_KEY` is set, with a local
heuristic parser as the final fallback. The frontend has its own heuristic parser too
(`parseJobPost` in `app.js`) for the no-backend path.

**Chrome extension** (`extension/`): the popup captures the *rendered* page text (for sites like
LinkedIn/Indeed/Workday that block backend URL fetching), POSTs it to `/api/extract-page`, and
opens an Antri tab with a prefilled draft passed via URL params (`openDraftFromUrl` /
`rememberDraftFromUrl` in `app.js`).

**One-time local→cloud migration:** if a signed-in account has no cloud rows but the browser has
locally saved cards, Antri offers a one-time upload (`localJobsForCloudMigration` /
`migrateLocalJobsToCloud`).

## Data model & a sync hazard

The `job_applications` schema lives in `supabase/job_applications.sql` (per-user Row Level
Security; users only touch their own rows). The DB uses `snake_case`; the frontend uses
`camelCase` — conversion happens in `jobToCloudRow` / `cloudRowToJob` in `app.js`.

The **`status` and `priority` enums are duplicated in three places** and must be kept in sync:
the SQL `check` constraints, `JOB_SCHEMA` in `server.py`, and the option lists in `app.js`.

## Deployment

Render runs `server.py` (canonical domain `antri.xyz`; `antri.onrender.com` is the origin).
Supabase holds the Postgres data and Auth. Changes to the static files or `server.py` ship via
the normal git → Render flow.
