import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { setUserPassword } from '@/lib/users';

export async function POST(request: NextRequest) {
  let token: string | undefined;
  let password: string | undefined;
  try {
    const body = await request.json();
    token = body.token;
    password = body.password;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!token || !password || password.length < 8) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const record = await kv.get<{ email: string; expiresAt: number }>(
    `reset:${token}`
  );
  if (!record || Date.now() > record.expiresAt) {
    return NextResponse.json(
      { error: 'Token invalid or expired' },
      { status: 400 }
    );
  }

  await setUserPassword(record.email, password);
  await kv.del(`reset:${token}`);
  return NextResponse.json({ ok: true });
}
