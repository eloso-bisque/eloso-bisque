import { redirect } from 'next/navigation'

// Paperclip AI Company Orchestration Platform
// Exposed via Cloudflare Quick Tunnel → localhost:3100
// Tunnel URL is stable for the server lifetime; update PAPERCLIP_TUNNEL_URL env var
// in Vercel and here if the server is rebooted and a new tunnel URL is assigned.
const PAPERCLIP_URL = process.env.PAPERCLIP_TUNNEL_URL || 'https://graduation-samples-present-contractors.trycloudflare.com'

export default function EloPage() {
  redirect(PAPERCLIP_URL)
}
