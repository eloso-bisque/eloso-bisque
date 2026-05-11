import { listUpcomingBookings, listPastBookings } from '@/lib/booking/db';
import type { Booking } from '@/lib/booking/types';
import AdminBookingsClient from './AdminBookingsClient';

export const dynamic = 'force-dynamic';

function formatDatetime(isoString: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoString));
}

export default function AdminBookingsPage() {
  const upcoming: Booking[] = listUpcomingBookings();
  const past: Booking[] = listPastBookings(50);

  const upcomingFormatted = upcoming.map(b => ({
    ...b,
    display_datetime: formatDatetime(b.start_utc, b.timezone),
  }));

  const pastFormatted = past.map(b => ({
    ...b,
    display_datetime: formatDatetime(b.start_utc, b.timezone),
  }));

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-bisque-900 mb-6">Bookings</h1>
      <AdminBookingsClient upcoming={upcomingFormatted} past={pastFormatted} />
    </div>
  );
}
