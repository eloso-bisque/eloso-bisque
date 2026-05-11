import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getUserByEmail, verifyPassword } from '@/lib/users';
import { signToken, COOKIE_NAME, SEVEN_DAYS } from '@/lib/auth';

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password required' },
      { status: 400 }
    );
  }

  const user = await getUserByEmail(email);
  // Constant-time: always hash-compare even if user not found
  const validPassword = user ? await verifyPassword(user, password) : false;

  if (!user || !validPassword) {
    return NextResponse.json(
      { error: 'Invalid email or password' },
      { status: 401 }
    );
  }

  const token = await signToken({
    sub: user.id,
    email: user.email,
    name: user.name,
  });

  // Track login activity
  try {
    const today = new Date().toISOString().split('T')[0];
    const loginKey = `activity:logins:${user.email}:${today}`;
    await kv.incr(loginKey);
    await kv.expire(loginKey, 90 * 24 * 3600);
    await kv.set(`activity:last_login:${user.email}`, new Date().toISOString());
  } catch (trackErr) {
    // Non-critical — don't fail login if tracking fails
    console.warn('[login] Activity tracking failed:', trackErr);
  }

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
