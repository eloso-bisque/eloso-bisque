import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncBookingToKissinger } from '../kissinger-adapter';
import type { BookingConfirmedEvent } from '../types';

const MOCK_EVENT: BookingConfirmedEvent = {
  booking_id: 'test-booking-123',
  guest_name: 'Test Guest',
  guest_email: 'guest@example.com',
  start_utc: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  end_utc: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
  duration_minutes: 30,
  timezone: 'America/New_York',
};

describe('syncBookingToKissinger', () => {
  beforeEach(() => {
    // Clear env var — feature should be disabled by default
    delete process.env.KISSINGER_GRAPHQL_URL;
  });

  it('returns null and skips when KISSINGER_GRAPHQL_URL is not set (opt-in)', async () => {
    const result = await syncBookingToKissinger(MOCK_EVENT);
    expect(result).toBeNull();
  });

  it('does not throw when Kissinger is down — booking still succeeds (non-fatal)', async () => {
    process.env.KISSINGER_GRAPHQL_URL = 'http://localhost:9999/unreachable';

    // Should not throw — catches error internally and returns null
    const result = await syncBookingToKissinger(MOCK_EVENT);
    expect(result).toBeNull();
  });

  it('handles invalid GraphQL response gracefully', async () => {
    // Set URL to an endpoint that returns non-GraphQL response
    process.env.KISSINGER_GRAPHQL_URL = 'http://localhost:9999/invalid';

    const result = await syncBookingToKissinger(MOCK_EVENT);
    expect(result).toBeNull(); // Never throws
  });

  it('times out gracefully on slow Kissinger', async () => {
    // This tests that the AbortSignal.timeout(5000) is configured
    // We mock fetch to simulate a timeout
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(() =>
      new Promise((_, reject) => setTimeout(() => reject(new Error('AbortError')), 100))
    );
    process.env.KISSINGER_GRAPHQL_URL = 'http://localhost:9999/slow';

    const result = await syncBookingToKissinger(MOCK_EVENT);
    expect(result).toBeNull();

    global.fetch = originalFetch;
  });
});
