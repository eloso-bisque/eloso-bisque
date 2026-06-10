import { NextResponse } from "next/server";

const VAULT_API_URL =
  process.env.VAULT_API_URL ?? "https://eloso-awp.myownlobster.ai/vault-api";
const VAULT_API_TOKEN = process.env.VAULT_API_TOKEN ?? "";

// Middleware already handles auth for all non-public routes.
// This route simply proxies to vault-api, keeping the bearer token server-side.
export async function GET() {
  const res = await fetch(`${VAULT_API_URL}/files`, {
    headers: { Authorization: `Bearer ${VAULT_API_TOKEN}` },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch file tree" },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
