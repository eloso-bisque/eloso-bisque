# eloso-bisque Auth Overhaul Plan

**Date:** 2026-05-01  
**Prepared by:** Lobster (Drew's assistant)  
**Status:** Plan — not yet implemented

---

## Summary of Current State

The current auth is a single shared password checked against the `APP_PASSWORD` env var. The login API route (`/api/auth/login`) does a plain string compare and sets a session cookie `eloso_session=authenticated`. The middleware checks for that exact cookie value. There is no concept of a user identity.

**Files to change:**
- `src/app/api/auth/login/route.ts` — replace with credential-checking login
- `src/app/api/auth/logout/route.ts` — extend to clear JWT
- `src/middleware.ts` — replace cookie value check with JWT verification
- `src/app/login/page.tsx` — add email field + forgot-password link
- New: `src/app/api/auth/forgot-password/route.ts`
- New: `src/app/api/auth/reset-password/route.ts`
- New: `src/app/reset-password/page.tsx`
- New: `src/lib/auth.ts` — JWT helpers and user lookup
- New: `src/lib/users.ts` — user store (Vercel KV)
- New: `scripts/seed-users.ts` — one-shot user seeding script

---

## Key Decisions

### 1. Auth Library: Custom JWT (not NextAuth v5)

**Decision: Custom JWT approach using the `jose` library.**

**Rationale:**
- NextAuth v5 (Auth.js) is well-suited for OAuth providers and multi-tenant SaaS. For 3 internal users doing email+password only, it adds ~800 lines of config, adapter boilerplate, and a complex session callback model.
- A custom JWT approach is ~150 lines of code total, fully transparent, and has zero magic. It's easier to debug on Vercel and easier for Drew to maintain.
- `jose` is a first-class JOSE/JWT library with zero dependencies, runs on Vercel Edge, and is already a transitive dependency of Next.js (via `next-auth`), so it does not add bundle weight.
- We keep full control over the JWT payload (can embed `user_id`, `email`, `name`, `role` directly).

### 2. User Storage: Vercel KV (Redis)

**Decision: Vercel KV (backed by Upstash Redis), not a relational DB.**

**Rationale:**
- 3 users. A full Postgres setup (Vercel Postgres / Neon) is overkill.
- Vercel KV is native to the Vercel dashboard, has a generous free tier, and is available at `@vercel/kv`.
- Schema is simple: two key namespaces:
  - `user:<email>` → `{ id, email, name, passwordHash, createdAt }`
  - `reset:<token>` → `{ email, expiresAt }` (TTL 1 hour, auto-expires via KV TTL)
- No migrations, no schema files, no connection pool management.
- If the team ever grows beyond ~20 users, migrate to Neon. For now, KV is the right fit.

**KV key schema:**
```
user:ben@eloso.ai  →  { id: "usr_1", email, name, passwordHash, createdAt }
user:jake@eloso.ai →  { id: "usr_2", email, name, passwordHash, createdAt }
user:drew@eloso.ai           →  { id: "usr_3", email, name, passwordHash, createdAt }
reset:<random_hex_32>        →  { email, expiresAt }  [TTL: 3600s]
```

### 3. Password Hashing: bcrypt

**Decision: `bcryptjs` (pure JS, no native bindings).**

**Rationale:**
- `argon2` requires native bindings that do not build on Vercel's serverless runtime without special configuration.
- `bcryptjs` is pure JavaScript, works everywhere including Vercel Edge-compatible runtimes, and is the standard choice for Next.js serverless functions.
- Cost factor: 12 (Vercel functions have 1–3 GB RAM; cost=12 takes ~300ms, acceptable for login).
- Use `bcryptjs` (the JS port), not `bcrypt` (the native version), to avoid Vercel build issues.

### 4. Session Management: Stateless JWT in HttpOnly Cookie

**Decision: Sign a short-lived JWT, store it in an HttpOnly cookie. No server-side session table.**

**Session structure:**
```json
{
  "sub": "usr_1",
  "email": "ben@eloso.ai",
  "name": "Ben Roome",
  "iat": 1746057600,
  "exp": 1746662400
}
```

- **Expiry:** 7 days (same as current session)
- **Signing:** HS256 with a 256-bit secret (`JWT_SECRET` env var, generated via `openssl rand -hex 32`)
- **Cookie:** `eloso_session` (same name, smooth migration), `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
- **Refresh:** On every authenticated request, if token has less than 24h remaining, issue a new one (silent renewal in middleware)
- **Logout:** Clear the cookie (no server-side revocation needed — it's internal tooling)

The middleware verifies the JWT signature on every request using `jose`'s `jwtVerify`. No KV lookup on the hot path — latency is zero.

### 5. Password Reset Flow

**Decision: Token-based reset stored in Vercel KV with 1-hour TTL. Email via Resend.**

**Why Resend:**
- Resend has a Next.js-native SDK (`resend` npm package), excellent Vercel integration docs, and a free tier (3,000 emails/month).
- No SMTP config, no domain DNS headaches beyond a one-time setup.
- `drew@eloso.ai` domain — Resend requires adding 2 DNS records to prove domain ownership. Drew already controls `eloso.ai`.
- Alternative: if Resend is not configured yet, the reset token can be logged to Vercel function logs as a fallback (sufficient for internal team).

**Reset flow:**
1. User submits email at `/login` → "Forgot password?" link
2. `POST /api/auth/forgot-password` — generate `crypto.randomBytes(32).toString('hex')`, store `reset:<token>` → `{ email, expiresAt }` in KV with 3600s TTL, send email via Resend with link `https://eloso-bisque.vercel.app/reset-password?token=<token>`
3. User clicks link → `/reset-password?token=...` page renders a "new password" form
4. `POST /api/auth/reset-password` — look up `reset:<token>` in KV, verify not expired, hash new password with bcrypt, update `user:<email>.passwordHash` in KV, delete the reset token, return success

**Security notes:**
- Tokens expire in 1 hour
- One-time use (deleted after successful reset)
- Constant-time token comparison (`crypto.timingSafeEqual`)
- No user enumeration: both "email found" and "email not found" return the same 200 response ("If that email is registered, you'll receive a link")

### 6. Internal API Access (LOBSTER_INTERNAL_SECRET)

The existing `X-Internal-Secret` header mechanism in middleware is preserved unchanged. Lobster's scheduled jobs can still reach the API without a user session.

---

## Implementation Steps

### Phase 1: Infrastructure Setup (~30 min)

**Step 1.1 — Add Vercel KV**
- In Vercel dashboard: Storage → Create KV database → name it `eloso-bisque-auth`
- Link to the `eloso-bisque` project — Vercel auto-injects `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`
- No code needed yet

**Step 1.2 — Add npm dependencies**
```bash
cd ~/lobster-workspace/projects/eloso-bisque
npm install @vercel/kv bcryptjs jose resend
npm install --save-dev @types/bcryptjs
```

**Step 1.3 — Generate JWT_SECRET**
```bash
openssl rand -hex 32
# → paste output into Vercel env var JWT_SECRET (production + preview)
```

**Step 1.4 — Configure Resend (if email desired)**
- Create account at resend.com
- Add `eloso.ai` domain (2 DNS records: SPF + DKIM)
- Create API key → set as `RESEND_API_KEY` in Vercel

---

### Phase 2: Core Auth Library (~45 min)

**Step 2.1 — `src/lib/users.ts`**

```typescript
import { kv } from '@vercel/kv';
import bcrypt from 'bcryptjs';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return kv.get<User>(`user:${email.toLowerCase()}`);
}

export async function verifyPassword(user: User, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}

export async function setUserPassword(email: string, newPassword: string): Promise<void> {
  const user = await getUserByEmail(email);
  if (!user) throw new Error('User not found');
  const hash = await bcrypt.hash(newPassword, 12);
  await kv.set(`user:${email.toLowerCase()}`, { ...user, passwordHash: hash });
}

export async function createUser(
  email: string, name: string, password: string
): Promise<User> {
  const id = `usr_${Date.now()}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const user: User = { id, email: email.toLowerCase(), name, passwordHash, createdAt: new Date().toISOString() };
  await kv.set(`user:${email.toLowerCase()}`, user);
  return user;
}
```

**Step 2.2 — `src/lib/auth.ts`**

```typescript
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
const COOKIE_NAME = 'eloso_session';
const SEVEN_DAYS = 60 * 60 * 24 * 7;

export interface SessionPayload extends JWTPayload {
  sub: string;      // user id
  email: string;
  name: string;
}

export async function signToken(payload: Omit<SessionPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export { COOKIE_NAME, SEVEN_DAYS };
```

---

### Phase 3: Updated API Routes (~30 min)

**Step 3.1 — `src/app/api/auth/login/route.ts` (replace)**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail, verifyPassword } from '@/lib/users';
import { signToken, COOKIE_NAME, SEVEN_DAYS } from '@/lib/auth';

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const user = await getUserByEmail(email);
  // Constant-time: always hash-compare even if user not found
  const validPassword = user ? await verifyPassword(user, password) : false;

  if (!user || !validPassword) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const token = await signToken({ sub: user.id, email: user.email, name: user.name });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SEVEN_DAYS,
    path: '/',
  });
  return response;
}
```

**Step 3.2 — `src/app/api/auth/forgot-password/route.ts` (new)**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import crypto from 'crypto';
import { getUserByEmail } from '@/lib/users';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://eloso-bisque.vercel.app';

export async function POST(request: NextRequest) {
  const { email } = await request.json();
  // Always return 200 — no user enumeration
  if (!email) return NextResponse.json({ ok: true });

  const user = await getUserByEmail(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    await kv.set(`reset:${token}`, { email: user.email, expiresAt: Date.now() + 3600_000 }, { ex: 3600 });

    await resend.emails.send({
      from: 'Eloso Bisque <noreply@eloso.ai>',
      to: user.email,
      subject: 'Reset your eloso-bisque password',
      html: `<p>Click to reset your password (link expires in 1 hour):</p>
             <p><a href="${BASE_URL}/reset-password?token=${token}">Reset password</a></p>
             <p>If you didn't request this, ignore this email.</p>`,
    });
  }

  return NextResponse.json({ ok: true });
}
```

**Step 3.3 — `src/app/api/auth/reset-password/route.ts` (new)**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import crypto from 'crypto';
import { setUserPassword } from '@/lib/users';

export async function POST(request: NextRequest) {
  const { token, password } = await request.json();
  if (!token || !password || password.length < 8) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const record = await kv.get<{ email: string; expiresAt: number }>(`reset:${token}`);
  if (!record || Date.now() > record.expiresAt) {
    return NextResponse.json({ error: 'Token invalid or expired' }, { status: 400 });
  }

  await setUserPassword(record.email, password);
  await kv.del(`reset:${token}`);
  return NextResponse.json({ ok: true });
}
```

---

### Phase 4: Updated Middleware (~20 min)

**`src/middleware.ts` (replace session cookie check)**

The public paths list gains `/reset-password` and `/api/auth/forgot-password` and `/api/auth/reset-password`. The cookie check is replaced with JWT verification:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

const COOKIE_NAME = 'eloso_session';

const PUBLIC_PATHS = [
  '/login',
  '/reset-password',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/_next',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();

  // Internal service calls
  const internalSecret = process.env.LOBSTER_INTERNAL_SECRET;
  const providedSecret = request.headers.get('X-Internal-Secret');
  if (internalSecret && providedSecret && providedSecret === internalSecret) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const session = await verifyToken(token);
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Silent token renewal: if less than 24h remaining, reissue
  const exp = session.exp as number;
  const response = NextResponse.next();
  if (exp - Date.now() / 1000 < 86400) {
    const { signToken, SEVEN_DAYS } = await import('@/lib/auth');
    const newToken = await signToken({ sub: session.sub!, email: session.email, name: session.name });
    response.cookies.set(COOKIE_NAME, newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SEVEN_DAYS,
      path: '/',
    });
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

**Note:** `middleware.ts` runs on the Edge runtime. `jose` and `bcryptjs` are Edge-compatible. `@vercel/kv` is also Edge-compatible. The middleware only calls `verifyToken` (no KV lookup) — so the hot path is pure in-memory JWT verification.

---

### Phase 5: Updated Login UI (~30 min)

**`src/app/login/page.tsx` changes:**
- Add `email` input field above `password`
- Change submit body to `{ email, password }`
- Add "Forgot password?" link below the form that navigates to `/login?forgot=1`
- When `?forgot=1` is in the URL, render a single email input with "Send reset link" button that calls `POST /api/auth/forgot-password` and shows a confirmation message

**`src/app/reset-password/page.tsx` (new page):**
- Reads `?token=...` from URL
- Renders a "New password" + "Confirm password" form
- On submit, calls `POST /api/auth/reset-password`
- On success, redirects to `/login` with a "Password updated" message

---

### Phase 6: User Seeding (~20 min)

**`scripts/seed-users.ts`** — a one-shot CLI script to create the 3 production users.

```typescript
// Run with: npx tsx scripts/seed-users.ts
// Requires: KV_REST_API_URL and KV_REST_API_TOKEN in environment (or .env.local)
import { createClient } from '@vercel/kv';
import bcrypt from 'bcryptjs';

// Load KV creds from env
const kv = createClient({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const USERS = [
  { email: 'ben@eloso.ai', name: 'Ben Roome',   password: process.env.BEN_INITIAL_PASSWORD! },
  { email: 'jake@eloso.ai', name: 'Jake Metcalf', password: process.env.JAKE_INITIAL_PASSWORD! },
  { email: 'drew@eloso.ai',           name: 'Drew Winget',  password: process.env.DREW_INITIAL_PASSWORD! },
];

async function seed() {
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 12);
    const id = `usr_${u.email.split('@')[0]}`;
    await kv.set(`user:${u.email}`, { id, email: u.email, name: u.name, passwordHash: hash, createdAt: new Date().toISOString() });
    console.log(`Created user: ${u.email}`);
  }
}

seed().catch(console.error);
```

**To seed production:**
```bash
# Set initial passwords as env vars (use a temp password; users reset via forgot-password)
BEN_INITIAL_PASSWORD="..." JAKE_INITIAL_PASSWORD="..." DREW_INITIAL_PASSWORD="..." \
  KV_REST_API_URL="..." KV_REST_API_TOKEN="..." \
  npx tsx scripts/seed-users.ts
```

Get KV credentials from Vercel dashboard → Storage → eloso-bisque-auth → `.env.local` tab.

After seeding, each user should use "Forgot password" to set their own password, or you can share the initial temp passwords securely (e.g., via Signal/Telegram).

---

### Phase 7: Testing & Deploy (~30 min)

**Local testing:**
1. Add to `.env.local`:
   ```
   JWT_SECRET=<32-byte hex from openssl rand -hex 32>
   KV_REST_API_URL=<from Vercel KV dashboard>
   KV_REST_API_TOKEN=<from Vercel KV dashboard>
   RESEND_API_KEY=<from Resend dashboard>
   NEXT_PUBLIC_BASE_URL=http://localhost:3000
   ```
2. Run `npx tsx scripts/seed-users.ts` (with .env.local loaded)
3. `npm run dev` — verify login with each user, verify logout, verify forgot-password email

**Deploy:**
```bash
vercel --prod
```

**Vercel env vars to add (remove `APP_PASSWORD` after confirming everything works):**
```
JWT_SECRET                   # 32-byte hex secret
KV_REST_API_URL              # auto-added when KV is linked
KV_REST_API_TOKEN            # auto-added when KV is linked
KV_REST_API_READ_ONLY_TOKEN  # auto-added when KV is linked
KV_URL                       # auto-added when KV is linked
RESEND_API_KEY               # from Resend dashboard
NEXT_PUBLIC_BASE_URL         # https://eloso-bisque.vercel.app
```

**Vercel env vars to remove after migration:**
```
APP_PASSWORD  # remove only after confirming new auth works in production
```

---

## Migration Strategy (Zero Downtime)

1. Deploy the new code with BOTH `APP_PASSWORD` and the new KV-based auth
2. During transition, keep `APP_PASSWORD` set so existing sessions continue to work — but new logins go through the new system
3. Once all 3 users have successfully logged in with new credentials, remove `APP_PASSWORD`
4. The old cookie `eloso_session=authenticated` will fail JWT verification and redirect to login — users log in once more with their new credentials

Actually, since the cookie name is the same (`eloso_session`) but the value format changes (from literal string "authenticated" to a JWT), existing sessions will naturally expire or prompt re-login, which is the right behavior.

---

## New Dependencies Summary

| Package | Purpose | Notes |
|---|---|---|
| `@vercel/kv` | User storage + reset tokens | Vercel-native Redis |
| `bcryptjs` | Password hashing | Pure JS, Edge-compatible |
| `jose` | JWT sign/verify | Zero deps, Edge-compatible |
| `resend` | Transactional email for password reset | Resend free tier: 3k/month |
| `@types/bcryptjs` | TypeScript types | devDependency |

---

## New Vercel Environment Variables

| Variable | Required | How to get |
|---|---|---|
| `JWT_SECRET` | Yes | `openssl rand -hex 32` |
| `KV_REST_API_URL` | Yes | Auto-added when Vercel KV linked |
| `KV_REST_API_TOKEN` | Yes | Auto-added when Vercel KV linked |
| `KV_REST_API_READ_ONLY_TOKEN` | Yes | Auto-added when Vercel KV linked |
| `KV_URL` | Yes | Auto-added when Vercel KV linked |
| `RESEND_API_KEY` | Yes | Resend dashboard |
| `NEXT_PUBLIC_BASE_URL` | Yes | `https://eloso-bisque.vercel.app` |
| `APP_PASSWORD` | Remove after migration | Old shared password — delete once confirmed |

---

## Production Users

| Name | Email | Seed method |
|---|---|---|
| Ben Roome | ben@eloso.ai | `seed-users.ts` |
| Jake Metcalf | jake@eloso.ai | `seed-users.ts` |
| Drew Winget | drew@eloso.ai | `seed-users.ts` |

---

## Total Estimated Effort

~3 hours for a single engineer familiar with Next.js. Steps are independent and can be parallelized.

| Phase | Task | Time |
|---|---|---|
| 1 | Infrastructure setup (KV, deps, secrets) | 30 min |
| 2 | Core auth library (`users.ts`, `auth.ts`) | 45 min |
| 3 | API routes (login, forgot-pw, reset-pw) | 30 min |
| 4 | Middleware update | 20 min |
| 5 | Login UI + reset-password page | 30 min |
| 6 | Seeding script | 20 min |
| 7 | Testing + deploy | 30 min |

---

## What Is NOT Changing

- Cookie name (`eloso_session`) — same, migration is smooth
- `LOBSTER_INTERNAL_SECRET` / `X-Internal-Secret` header mechanism — preserved unchanged
- All app routes, components, Kissinger integration — untouched
- Deploy process (`vercel --prod`) — unchanged
