import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';

// This endpoint is protected by middleware (not in PUBLIC_PATHS).
// Only authenticated users can reach it.

function generateTemporalToken(secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${timestamp}:temporal`;
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  // Format: timestamp.hmac — the validator reconstructs the payload and checks HMAC
  return `${timestamp}.${hmac}`;
}

export async function GET(_request: NextRequest) {
  const secret = process.env.TEMPORAL_TOKEN_SECRET;
  if (!secret) {
    console.error('[temporal-token] TEMPORAL_TOKEN_SECRET not configured');
    return NextResponse.json(
      { error: 'Temporal SSO not configured' },
      { status: 503 }
    );
  }

  const temporalUrl = process.env.TEMPORAL_UI_URL ?? 'https://eloso-awp.myownlobster.ai/temporal/';
  const token = generateTemporalToken(secret);
  const redirectUrl = new URL(temporalUrl);
  redirectUrl.searchParams.set('token', token);

  return NextResponse.redirect(redirectUrl.toString(), { status: 302 });
}
