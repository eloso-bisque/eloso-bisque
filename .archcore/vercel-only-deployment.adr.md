---
title: Deploy Exclusively to Vercel — No Self-Hosting
status: accepted
tags:
  - deployment
  - infrastructure
---

## Context

eloso-bisque is a Next.js 14 App Router application that needs managed deployment with automatic SSL, CDN, preview deployments, and environment variable management.

## Decision

Deploy exclusively to Vercel. Never self-host this application via Docker, PM2, or any other mechanism.

## Details

- **Canonical URL:** `https://eloso-bisque.vercel.app`
- **Vercel project ID:** `prj_JYoaN4wGDGZfiYm354qfWtkYN9vy`
- **Vercel org:** `team_fRfZ3mU8CnAAGomhEe0sDU4t`
- **No `vercel.json`** — Vercel auto-detects Next.js and uses defaults

## Deploy Command

```bash
cd ~/lobster-workspace/projects/eloso-bisque
vercel --prod
```

## Environment Variables (Vercel Dashboard Only)

| Variable | Required | Notes |
|---|---|---|
| `KISSINGER_API_URL` | Yes | Server-side only — no NEXT_PUBLIC_ prefix |
| `KISSINGER_API_TOKEN` | Yes | Bearer token — use printf not echo to avoid newlines |
| `APP_PASSWORD` | Yes | Single shared team password |
| `JWT_SECRET` | Yes | Signs session JWTs |
| `KV_REST_API_URL` | For KV features | Vercel KV |
| `KV_REST_API_TOKEN` | For KV features | Vercel KV |

Set vars with `printf` to avoid trailing newlines:

```bash
printf 'your-value' | vercel env add VARIABLE_NAME production
```

## Consequences

- Vercel handles build, CDN, SSL, and edge routing automatically
- Preview deployments are created on every git push to feature branches
- Env vars must be set via `vercel env add` or the Vercel dashboard — `.env.local` only applies to local dev
