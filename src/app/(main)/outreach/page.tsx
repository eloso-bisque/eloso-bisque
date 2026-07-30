import { Suspense } from "react";
import { cookies } from "next/headers";
import { type TeamMember } from "@/lib/outreach";
import { verifyToken } from "@/lib/auth";
import { OutreachContent } from "./OutreachContent";

export const metadata = {
  title: "Outreach — Eloso Bisque",
};

/** Map from login email to TeamMember name (case-insensitive). */
const EMAIL_TO_MEMBER: Record<string, TeamMember> = {
  "drew@eloso.ai": "Drew",
  "ben@eloso.ai": "Ben",
  "jake@eloso.ai": "Jake",
};

/** Skeleton shown while OutreachContent is loading data. */
function OutreachSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 bg-bisque-200 rounded w-48" />
      <div className="h-10 bg-bisque-100 rounded" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 bg-bisque-100 rounded" />
        ))}
      </div>
    </div>
  );
}

export default async function OutreachPage() {
  // Decode the session cookie to identify the logged-in user.
  // currentMember is used to scope the "Open Next 8" button to the user's own queue.
  // We do this outside the Suspense boundary so it resolves before the shell renders.
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("eloso_session");
  let currentMember: TeamMember | null = null;
  if (sessionCookie?.value) {
    const payload = await verifyToken(sessionCookie.value);
    if (payload?.email) {
      currentMember = EMAIL_TO_MEMBER[payload.email.toLowerCase()] ?? null;
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header renders immediately — no data fetch needed */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-bisque-900">Outreach</h1>
          <p className="text-sm text-bisque-500 mt-1">
            Personalized LinkedIn outreach tasks
          </p>
        </div>
      </div>

      {/* Heavy data fetch deferred — page shell paints while Postgres/Kissinger respond */}
      <Suspense fallback={<OutreachSkeleton />}>
        <OutreachContent currentMember={currentMember} />
      </Suspense>
    </div>
  );
}
