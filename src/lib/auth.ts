import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
const COOKIE_NAME = 'eloso_session';
const SEVEN_DAYS = 60 * 60 * 24 * 7;

export interface SessionPayload extends JWTPayload {
  sub: string; // user id
  email: string;
  name: string;
}

export async function signToken(
  payload: Omit<SessionPayload, 'iat' | 'exp'>
): Promise<string> {
  return new SignJWT(payload as JWTPayload)
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
