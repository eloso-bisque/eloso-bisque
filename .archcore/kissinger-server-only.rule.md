---
title: All Kissinger API Calls Must Be Server-Side Only
status: accepted
tags:
  - kissinger
  - security
  - data-fetching
---

All calls to the Kissinger GraphQL API must happen exclusively in Next.js Server Components, API routes, or server-side utility functions. The Kissinger API URL and token must never be exposed to the browser.

## Rationale

`KISSINGER_API_URL` and `KISSINGER_API_TOKEN` are private environment variables with **no** `NEXT_PUBLIC_` prefix. If these were used in client components, they would be undefined at runtime and could expose credentials if ever misconfigured.

## Required Pattern

All Kissinger queries go through `@src/lib/kissinger.ts`, which reads the env vars server-side. This file must only be imported from:

- Next.js Server Components (files with no `"use client"` directive)
- Next.js API Route handlers (`src/app/api/**/route.ts`)
- Server Actions

## Prohibited Patterns

- Do NOT import `kissinger.ts` from any `"use client"` component
- Do NOT add `NEXT_PUBLIC_KISSINGER_*` env vars
- Do NOT fetch GraphQL from the client via `fetch()` or `graphql-request`
- Do NOT pass raw Kissinger entity IDs as query params without validation

## Production Data Flow

```
Browser → Vercel SSR → KISSINGER_API_URL (nginx at eloso-awp) → kissinger-api (port 8080) → CozoDB
```

## Error Handling

Every Kissinger fetch function must catch errors and return `null` or an empty array. The UI must render empty states gracefully — never crash when Kissinger is unreachable.
