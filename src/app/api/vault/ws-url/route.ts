import { NextResponse } from "next/server";

// Returns the WebSocket URL and token for the client to use.
// Auth is handled by middleware. This keeps the token available to the client
// for the WebSocket connection (which can't use HTTP cookies easily).
export async function GET() {
  const wsUrl = process.env.VAULT_WS_URL ?? "wss://eloso-awp.myownlobster.ai/vault-ws";
  const token = process.env.VAULT_API_TOKEN ?? "";

  return NextResponse.json({ wsUrl, token });
}
