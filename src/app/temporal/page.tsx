import { redirect } from 'next/navigation'

// Temporal Workflow Orchestration UI
// Exposed via Cloudflare Quick Tunnel → localhost:8088
// Tunnel URL is stable for the server lifetime; update TEMPORAL_TUNNEL_URL env var
// in Vercel and here if the server is rebooted and a new tunnel URL is assigned.
const TEMPORAL_URL = process.env.TEMPORAL_TUNNEL_URL || 'https://absent-willow-publication-skating.trycloudflare.com'

export default function TemporalPage() {
  redirect(TEMPORAL_URL)
}
