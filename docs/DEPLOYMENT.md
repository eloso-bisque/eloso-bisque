# eloso-bisque Deployment Reference
Last updated: 2026-04-01

## Overview

eloso-bisque is a Next.js 14 CRM frontend that displays data from the Kissinger graph CRM. It deploys **exclusively to Vercel** — never self-hosted.

**Canonical URL:** `https://eloso-bisque.vercel.app`
**Vercel project ID:** `prj_JYoaN4wGDGZfiYm354qfWtkYN9vy`
**Vercel org:** `team_fRfZ3mU8CnAAGomhEe0sDU4t`

## Deploy

```bash
cd ~/lobster-workspace/projects/eloso-bisque
vercel --prod
```

That's it. Vercel handles build, CDN, and SSL automatically.

## Environment Variables

All must be set in Vercel (not `.env.local`, which only applies to local dev).

| Variable | Required | Description |
|---|---|---|
| `KISSINGER_API_URL` | Yes | URL of the Kissinger GraphQL endpoint. In production: `https://eloso-awp.myownlobster.ai/kissinger/graphql` |
| `KISSINGER_API_TOKEN` | Yes | Bearer token for Kissinger API auth. Must match nginx config and `KISSINGER_API_TOKEN` in kissinger-api. |
| `APP_PASSWORD` | Yes | Login password for the CRM (single shared password) |

**IMPORTANT:** `KISSINGER_API_URL` has **no `NEXT_PUBLIC_` prefix** — it is server-side only and is never exposed to the browser. Do not add it as a public env var.

### Setting env vars

Use `printf` (not `echo`) to avoid trailing newlines that break auth tokens:

```bash
printf 'https://eloso-awp.myownlobster.ai/kissinger/graphql' | vercel env add KISSINGER_API_URL production
printf 'your-bearer-token-here' | vercel env add KISSINGER_API_TOKEN production
printf 'your-app-password' | vercel env add APP_PASSWORD production
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

eloso-bisque uses a simple cookie-based session:

- Cookie name: `eloso_session`
- Cookie value: `authenticated`
- Expires: 7 days
- Login route: `POST /api/auth/login` — checks `APP_PASSWORD` env var
- Middleware at `src/middleware.ts` guards all routes except `/login`, `/api/auth/*`, `/_next`

There is no user management — it's a single shared password for a trusted team.

## Kissinger Integration

All Kissinger GraphQL calls happen **server-side** in Next.js Server Components and API routes. The client (browser) never sees the API URL or token.

Client helper: `src/lib/kissinger.ts`
- Reads `KISSINGER_API_URL` and `KISSINGER_API_TOKEN` from environment
- Defaults to `http://localhost:8080/graphql` if `KISSINGER_API_URL` is unset (useful for local dev)
- Uses Next.js 14 fetch with `next: { revalidate: 60 }` — 60-second cache on all queries

**Production data flow:**
```
Browser → Vercel SSR → KISSINGER_API_URL (nginx at eloso-awp) → kissinger-api (port 8080) → CozoDB
```

## Local Development

```bash
cd ~/lobster-workspace/projects/eloso-bisque
npm install

# Create .env.local for local dev:
cat > .env.local << 'EOF'
KISSINGER_API_URL=http://localhost:8080/graphql
KISSINGER_API_TOKEN=   # leave empty if kissinger-api has no token set locally
APP_PASSWORD=localdev
EOF

npm run dev
# Runs at http://localhost:3000
```

Ensure kissinger-api is running locally (`pm2 start kissinger-api` or run the binary directly).

## Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **GraphQL client:** `graphql-request` v7
- **Auth:** Cookie session (custom, no NextAuth)
- **Deployment:** Vercel

## Vercel Configuration

No `vercel.json` — Vercel auto-detects Next.js and uses its defaults. The only configuration is env vars set via the Vercel dashboard or CLI.

## Dependencies on Other Services

| Service | How used | Failure mode |
|---|---|---|
| kissinger-api | GraphQL queries for all data | Returns `null` gracefully; app shows empty states |
| nginx (eloso-awp.myownlobster.ai) | Public proxy for Kissinger API | Kissinger data unavailable; auth bearer enforced here |

The app handles Kissinger being unreachable gracefully — all fetch functions catch errors and return `null`, which the UI renders as empty states (not crashes).
