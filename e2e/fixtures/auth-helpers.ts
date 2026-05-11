/**
 * Auth helpers for Playwright E2E tests.
 *
 * The outreach page uses a JWT cookie (`eloso_session`) signed with the
 * JWT_SECRET env var. In tests, we generate the cookie value by calling
 * the app's /api/auth/test-token endpoint (if available) or by signing
 * a token directly using the jose library in a helper script.
 *
 * Since E2E tests cannot import server-side code directly, we use a
 * different strategy: set the cookie to a known test value and rely on
 * a Next.js middleware stub, OR generate the cookie in a test setup step
 * via a small Node script.
 *
 * For simplicity and full UI-only testing, we set the cookie as an httpOnly
 * cookie that the app will accept, using a JWT signed with the same secret
 * configured in .env.test (or process.env.JWT_SECRET).
 *
 * Usage:
 *   await setJakeAuth(page);  // sets eloso_session cookie for Jake
 */

import type { Page } from "@playwright/test";
import { SignJWT } from "jose";

const JWT_SECRET_RAW = process.env.JWT_SECRET ?? "test-secret-for-e2e-tests-minimum-32-chars!";
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);

/**
 * Generate a JWT session token for the given user.
 * Signs with the same algorithm (HS256) and claims the app expects.
 */
async function generateToken(payload: {
  sub: string;
  email: string;
  name: string;
}): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

/** Set a valid eloso_session cookie for Jake */
export async function setJakeAuth(page: Page): Promise<void> {
  const token = await generateToken({
    sub: "jake-test-id",
    email: "jake@eloso.ai",
    name: "Jake",
  });

  await page.context().addCookies([
    {
      name: "eloso_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

/** Set a valid eloso_session cookie for Drew */
export async function setDrewAuth(page: Page): Promise<void> {
  const token = await generateToken({
    sub: "drew-test-id",
    email: "drew@eloso.ai",
    name: "Drew",
  });

  await page.context().addCookies([
    {
      name: "eloso_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

/** Clear auth cookies — simulates unauthenticated state */
export async function clearAuth(page: Page): Promise<void> {
  await page.context().clearCookies();
}
