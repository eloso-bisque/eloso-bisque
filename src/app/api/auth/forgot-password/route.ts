import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import crypto from 'crypto';
import { getUserByEmail } from '@/lib/users';
import { Resend } from 'resend';

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? 'https://eloso-bisque.vercel.app';

// Use resend.dev shared sender as fallback if eloso.ai domain isn't verified yet.
// Once eloso.ai is verified in Resend dashboard, change this to noreply@eloso.ai.
const FROM_ADDRESS =
  process.env.RESEND_FROM_ADDRESS ?? 'Eloso Bisque <onboarding@resend.dev>';

export async function POST(request: NextRequest) {
  let email: string | undefined;
  try {
    const body = await request.json();
    email = body.email;
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Always return 200 — no user enumeration
  if (!email) return NextResponse.json({ ok: true });

  const user = await getUserByEmail(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const resetLink = `${BASE_URL}/reset-password?token=${token}`;

    await kv.set(
      `reset:${token}`,
      { email: user.email, expiresAt: Date.now() + 3_600_000 },
      { ex: 3600 }
    );

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      try {
        const { error } = await resend.emails.send({
          from: FROM_ADDRESS,
          to: user.email,
          subject: 'Reset your eloso-bisque password',
          html: `<p>Click to reset your password (link expires in 1 hour):</p>
                 <p><a href="${resetLink}">Reset password</a></p>
                 <p>If you didn't request this, ignore this email.</p>`,
        });
        if (error) {
          // Log Resend errors but don't expose them to the client
          console.error('[password-reset] Resend error:', JSON.stringify(error));
          // Fallback log so the link isn't lost
          console.log(`[password-reset] FALLBACK link for ${user.email}: ${resetLink}`);
        }
      } catch (err) {
        console.error('[password-reset] Resend threw:', err);
        console.log(`[password-reset] FALLBACK link for ${user.email}: ${resetLink}`);
      }
    } else {
      // RESEND_API_KEY not set — log reset link so it can be retrieved from Vercel logs.
      // Set RESEND_API_KEY in Vercel to enable email delivery.
      console.log(`[password-reset] NO_EMAIL_KEY — reset link for ${user.email}: ${resetLink}`);
    }
  }

  return NextResponse.json({ ok: true });
}
