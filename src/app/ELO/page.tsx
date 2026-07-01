import { redirect } from 'next/navigation';

// Redirect to the Paperclip instance exposed at the eloso-awp nginx server.
// No basic auth — Paperclip handles its own authentication.
export default function EloPage() {
  redirect('https://eloso-awp.myownlobster.ai/ELO/');
}
