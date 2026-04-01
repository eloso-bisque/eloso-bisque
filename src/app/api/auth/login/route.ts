import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "eloso_session";
const SEVEN_DAYS = 60 * 60 * 24 * 7;

export async function POST(request: NextRequest) {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { password } = body;
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) {
    console.error("APP_PASSWORD env var is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  if (!password || password !== appPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SEVEN_DAYS,
    path: "/",
  });

  return response;
}
