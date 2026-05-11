import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME, SEVEN_DAYS, signToken } from '@/lib/auth';

const PUBLIC_PATHS = [
  '/login',
  '/reset-password',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/_next',
  '/favicon.ico',
  // bisque-booking public routes
  '/book',
  '/cancel',
  '/reschedule',
  '/api/booking/slots',
  '/api/booking/create',
  '/api/booking/cancel',
  '/api/booking/reschedule',
  '/api/cron/reminders',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) =>
      pathname === p ||
      pathname.startsWith(p + '/') ||
      pathname.startsWith(p)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();

  // Allow service-to-service calls that present a valid X-Internal-Secret header.
  // This check runs before the session cookie check so internal API calls (e.g.
  // scheduled jobs run by Lobster) can reach route handlers without a browser session.
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

  const response = NextResponse.next();

  // Silent token renewal: if less than 24h remaining, reissue
  const exp = session.exp as number;
  if (exp - Date.now() / 1000 < 86400) {
    const newToken = await signToken({
      sub: session.sub!,
      email: session.email,
      name: session.name,
    });
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
