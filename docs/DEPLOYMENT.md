# eloso-bisque Deployment Reference
Last updated: 2026-07-30

## Overview

eloso-bisque is Eloso's internal sales CRM — a Next.js 14 app used by Drew, Ben, and
Jake to run outbound prospecting, investor pipeline, and funnel tracking. **Postgres
(via Prisma) is the primary datastore** for all CRUD paths as of the 2026-07-22
Kissinger→Postgres migration (PRs #41–53) and the 2026-07-22 dual-write removal
(PR #53). The Kissinger graph CRM (Rust CLI + CozoDB, GraphQL API) is **not
decommissioned**, but the live frontend only still reads from it for two things:

- The Contacts **"All" tab and search box** — no Postgres equivalent exists yet for
  Kissinger's ranked cross-entity full-text search.
- The contact detail **Intro Path** tab — graph (BFS) traversal for warm-intro
  discovery, which Postgres does not model.

Everything else (contacts CRUD, notes/funnel/investor-pipeline mutations, contact
events, scores, homepage stats, booking sync) reads and writes Postgres directly.
See `docs/decisions-and-context.md` for the full migration history and the open
question of when Kissinger itself gets decommissioned (no date scheduled as of
2026-07-22; a 2+ week stable-observation window was the original plan).

It deploys **exclusively to Vercel** — never self-hosted.

**Canonical URL:** `https://eloso-bisque-virid.vercel.app`
**Vercel project ID:** `prj_rXjDcC3Bdv3vgN0md6eOZAOGza4F`
**Vercel org/team:** `fully-parsed` (org ID `team_FYIdgKboAPLQQkvAMgjwpp8A`)

The previous values recorded here (`eloso-bisque.vercel.app`, project
`prj_JYoaN4wGDGZfiYm354qfWtkYN9vy`, org `team_fRfZ3mU8CnAAGomhEe0sDU4t`) were wrong —
verified against the actual linked project via `cat .vercel/project.json` and
`vercel project inspect eloso-bisque --scope fully-parsed`, both confirming the
values above. This matches a correction already recorded in
`docs/decisions-and-context.md` (2026-07-21, ~19:50 UTC): the CLI's default team
scope had been wrong since day one, and the real project lives under the
**"fully-parsed"** Vercel team, not `drew-wingets-projects`.

## Deploy

```bash
cd ~/lobster-workspace/projects/eloso-bisque
vercel --prod
```

That's it. Vercel handles build, CDN, and SSL automatically.

## Environment Variables

All must be set in Vercel (not `.env.local`, which only applies to local dev). This
list covers the variables required for the app to boot and serve the core CRM paths;
it is not exhaustive of every integration (booking/email, Temporal, vault-api) — see
`.env.example` and `src/lib/**` for the full set.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (Neon, provisioned via the Vercel marketplace integration). Read by `prisma.config.ts` and `src/lib/prisma.ts`; this is now the primary datastore. |
| `JWT_SECRET` | Yes | Signing secret for session JWTs (see Auth section below). Read by `src/lib/auth.ts`. |
| `KISSINGER_API_URL` | Yes | URL of the Kissinger GraphQL endpoint. In production: `https://eloso-awp.myownlobster.ai/kissinger/graphql`. Still required — Kissinger backs the Contacts "All" tab/search and the Intro Path tab (see Overview). |
| `KISSINGER_API_TOKEN` | Yes | Bearer token for Kissinger API auth. Must match nginx config and `KISSINGER_API_TOKEN` in kissinger-api. |
| `LOBSTER_INTERNAL_SECRET` | Recommended | Shared secret checked against the `X-Internal-Secret` request header in `src/middleware.ts`, allowing service-to-service calls (e.g. Lobster scheduled jobs) to bypass session auth. |

**Removed:** `APP_PASSWORD` (single shared password) no longer exists in the codebase —
it was superseded by the 2026-05-01 auth overhaul (per-user email+password, JWT
sessions; see Auth section below). Setting it in Vercel today has no effect.

**IMPORTANT:** `KISSINGER_API_URL` has **no `NEXT_PUBLIC_` prefix** — it is server-side only and is never exposed to the browser. Do not add it as a public env var. The same applies to `DATABASE_URL` and `JWT_SECRET`.

### Setting env vars

Use `printf` (not `echo`) to avoid trailing newlines that break auth tokens:

```bash
printf 'postgres://...' | vercel env add DATABASE_URL production
printf 'your-jwt-secret' | vercel env add JWT_SECRET production
printf 'https://eloso-awp.myownlobster.ai/kissinger/graphql' | vercel env add KISSINGER_API_URL production
printf 'your-bearer-token-here' | vercel env add KISSINGER_API_TOKEN production
```

### Checking current env vars

```bash
vercel env ls production
```

### Removing a var

```bash
vercel env rm VARIABLE_NAME production
```

## Auth

eloso-bisque uses per-user email+password auth with JWT sessions (since the
2026-05-01 auth overhaul — this replaced an earlier single-shared-password scheme):

- Cookie name: `eloso_session`
- Cookie value: a signed JWT (`jose`, HS256, signed with `JWT_SECRET`) carrying user
  id, email, and name — see `src/lib/auth.ts`
- Expires: 7 days
- Login route: `POST /api/auth/login` — verifies bcrypt-hashed password against the
  `User` table in Postgres
- Middleware at `src/middleware.ts` guards all routes except a documented allowlist
  (`/login`, `/reset-password`, `/api/auth/*`, the public booking routes, and a couple
  of prospect-facing landing pages); it also lets service-to-service calls through
  when they present a header matching `LOBSTER_INTERNAL_SECRET`

There is no role-based access control — all authenticated team members have equal
access, including to `/admin/*`.

## Kissinger Integration

Kissinger GraphQL calls happen **server-side** only, in Next.js Server Components and
API routes. The client (browser) never sees the API URL or token. As of the
2026-07-22 migration, this is now a narrow integration — only the Contacts "All"
tab/search and the Intro Path tab call Kissinger; every other CRUD path reads/writes
Postgres directly via Prisma (`src/lib/prisma.ts`).

Client helper: `src/lib/kissinger.ts`
- Reads `KISSINGER_API_URL` and `KISSINGER_API_TOKEN` from environment
- Defaults to `http://localhost:8080/graphql` if `KISSINGER_API_URL` is unset (useful for local dev)
- Uses Next.js 14 fetch with `next: { revalidate: 60 }` — 60-second cache on all queries

**Production data flow (Postgres path, primary):**
```
Browser → Vercel SSR/API routes → DATABASE_URL (Neon Postgres, via Prisma)
```

**Production data flow (Kissinger path, search + intro-path only):**
```
Browser → Vercel SSR → KISSINGER_API_URL (nginx at eloso-awp) → kissinger-api (port 8080) → CozoDB
```

## Local Development

```bash
cd ~/lobster-workspace/projects/eloso-bisque
npm install
npx prisma generate   # required once after install — see note below

# Create .env.local for local dev:
cat > .env.local << 'EOF'
DATABASE_URL=postgres://...       # local Postgres or a Neon dev branch
JWT_SECRET=some-local-dev-secret
KISSINGER_API_URL=http://localhost:8080/graphql
KISSINGER_API_TOKEN=   # leave empty if kissinger-api has no token set locally
EOF

npm run dev
# Runs at http://localhost:3000
```

**Note on `prisma generate`:** the Prisma client is generated into
`node_modules/@prisma/client` and is not checked into the repo. `npm run build`
runs `prisma generate` automatically (see `package.json`), but a fresh `npm install`
followed directly by `npm test`/`npx vitest run` (skipping `build`) will fail several
test files with `Cannot find module '.prisma/client/default'` unless you run
`npx prisma generate` yourself first. No `DATABASE_URL` is required for `generate`
(only for actually connecting).

Kissinger is only needed locally if you're touching the Contacts "All" tab/search or
the Intro Path tab — everything else works against Postgres alone. If you do need it,
ensure kissinger-api is running locally (`pm2 start kissinger-api` or run the binary
directly).

## Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Primary datastore:** PostgreSQL (Neon) via Prisma ORM (`prisma@7.8.0`, `@prisma/adapter-pg`)
- **GraphQL client (Kissinger, narrow use — search + intro-path only):** `graphql-request` v7
- **Auth:** Cookie session, JWT (`jose`) + bcrypt password hashes (custom, no NextAuth)
- **Deployment:** Vercel

## Vercel Configuration

No `vercel.json` — Vercel auto-detects Next.js and uses its defaults. The only configuration is env vars set via the Vercel dashboard or CLI.

## Dependencies on Other Services

| Service | How used | Failure mode |
|---|---|---|
| Neon Postgres (`DATABASE_URL`) | Primary datastore for all CRM CRUD (contacts, outreach, funnel, investors, activity) via Prisma | App-wide outage — this is now the primary read/write path |
| kissinger-api | GraphQL queries for the Contacts "All" tab/search and Intro Path graph traversal only | Returns `null` gracefully; those two features show empty states, everything else is unaffected |
| nginx (eloso-awp.myownlobster.ai) | Public proxy for Kissinger API | Same as above |

The app handles Kissinger being unreachable gracefully — all fetch functions catch errors and return `null`, which the UI renders as empty states (not crashes). Postgres is not treated the same way (no fallback) since it is now the primary store.
