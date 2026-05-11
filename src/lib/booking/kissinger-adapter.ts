/**
 * Kissinger integration seam for bisque-booking.
 * Opt-in via KISSINGER_GRAPHQL_URL env var.
 * Failures NEVER block booking — always catch and log.
 */

import type { BookingConfirmedEvent } from './types';

const UPSERT_CONTACT_MUTATION = `
  mutation UpsertContact($name: String!, $email: String!) {
    upsertEntityByEmail(name: $name, email: $email) {
      id
      name
    }
  }
`;

const LOG_INTERACTION_MUTATION = `
  mutation LogBookingInteraction($input: CreateInteractionInput!) {
    logInteraction(input: $input) {
      id
    }
  }
`;

interface UpsertResult {
  upsertEntityByEmail: { id: string; name: string };
}

async function kissingerGql<T>(
  url: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Kissinger request failed: ${res.status}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors?.length) {
    throw new Error(`Kissinger GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

/**
 * Fire-and-forget: upsert contact + log booking interaction in Kissinger.
 * Returns the Kissinger contact ID on success, null on failure or if disabled.
 */
export async function syncBookingToKissinger(event: BookingConfirmedEvent): Promise<string | null> {
  const kissingerUrl = process.env.KISSINGER_GRAPHQL_URL;
  if (!kissingerUrl) {
    // Feature disabled — not an error
    return null;
  }

  const token = process.env.KISSINGER_API_TOKEN ?? '';

  try {
    // Upsert the contact by email
    const upsertData = await kissingerGql<UpsertResult>(
      kissingerUrl,
      token,
      UPSERT_CONTACT_MUTATION,
      { name: event.guest_name, email: event.guest_email }
    );

    const contactId = upsertData.upsertEntityByEmail.id;

    // Log a booking interaction
    await kissingerGql(kissingerUrl, token, LOG_INTERACTION_MUTATION, {
      input: {
        kind: 'meeting',
        subject: `Booking: ${event.start_utc}`,
        notes: `bisque-booking: ${event.duration_minutes}-minute meeting. Booking ID: ${event.booking_id}`,
        participantIds: [contactId],
        occurredAt: event.start_utc,
      },
    });

    console.log(`[bisque-booking] Kissinger sync OK: contact ${contactId}`);
    return contactId;
  } catch (err) {
    // Never block booking on Kissinger failure
    console.error('[bisque-booking] Kissinger sync failed (non-fatal):', err);
    return null;
  }
}
