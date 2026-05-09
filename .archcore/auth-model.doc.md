---
title: Authentication Model — Single Shared Password + JWT Sessions
status: accepted
tags:
  - auth
  - security
---

eloso-bisque uses a simple single-password auth model suitable for a small trusted team. There is no user management, no OAuth, and no NextAuth.

## How It Works

1. User visits any protected route → middleware checks for valid `eloso_session` cookie
2. If no valid cookie → redirected to `/login`
3. User enters the shared `APP_PASSWORD` env var
4. On success → server signs a JWT and sets `eloso_session` cookie (7-day expiry)
5. Subsequent requests: middleware verifies JWT signature

## Key Files

- `@src/lib/auth.ts` — JWT sign/verify using `jose` (HS256, `JWT_SECRET` env var)
- `@src/middleware.ts` — protects all routes except `/login`, `/api/auth/*`, `/_next`
- `@src/app/api/auth/login/route.ts` — validates `APP_PASSWORD`, issues JWT
- `@src/app/api/auth/logout/route.ts` — clears cookie
- `@src/app/api/auth/forgot-password/route.ts` — sends reset email via Resend
- `@src/app/api/auth/reset-password/route.ts` — handles password reset token

## Session Cookie

- Name: `eloso_session`
- Value: signed JWT
- Expiry: 7 days
- HttpOnly: yes
- SameSite: strict

## Environment Variables

| Var | Required | Description |
|---|---|---|
| `APP_PASSWORD` | Yes | Single shared team password |
| `JWT_SECRET` | Yes | Secret for HS256 JWT signing |

## Multi-User Context

Although there's a single shared password, session JWTs include `name` and `email` fields (from `SessionPayload`). These are set at login from the `users.ts` lookup. This supports per-user outreach queues (e.g., `queue:drew`).

## What NOT to Do

- Do not add NextAuth or passport.js — this auth model is intentionally minimal
- Do not add per-user passwords — the shared password model is a deliberate choice
- Do not expose `JWT_SECRET` via `NEXT_PUBLIC_` prefix
