import { NextRequest, NextResponse } from "next/server";

const VAULT_API_URL =
  process.env.VAULT_API_URL ?? "https://eloso-awp.myownlobster.ai/vault-api";
const VAULT_API_TOKEN = process.env.VAULT_API_TOKEN ?? "";

// Middleware handles auth. These routes proxy vault-api, keeping the token server-side.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json(
      { error: "path query parameter is required" },
      { status: 400 }
    );
  }

  const url = `${VAULT_API_URL}/file?path=${encodeURIComponent(filePath)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${VAULT_API_TOKEN}` },
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch file" },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  let body: { path: string; content: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.path || typeof body.content !== "string") {
    return NextResponse.json(
      { error: "path and content are required" },
      { status: 400 }
    );
  }

  const res = await fetch(`${VAULT_API_URL}/file`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VAULT_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: body.path, content: body.content }),
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to write file" },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
