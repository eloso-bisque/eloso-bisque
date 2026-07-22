import { NextResponse } from "next/server";
import {
  ACTIVITY_DASHBOARD_DAYS,
  buildActivityDashboardResponse,
  fetchActivityDashboardData,
  getDates,
  resolveDashboardUsers,
} from "@/lib/activity-dashboard";

// Prisma Phase 3.1 cutover: this route used to read Vercel KV counters
// directly (`activity:logins:*`, `activity:outreach_sent:*`). It now reads
// from Postgres `ActivityLog` rows instead (docs/prisma-schema-design.md
// section 3.7). The KV writes themselves are untouched and continue as a
// rollback safety net — see src/lib/activity-log.ts.
export async function GET() {
  const dates = getDates(ACTIVITY_DASHBOARD_DAYS);
  const dashboardUsers = await resolveDashboardUsers();
  const userIds = dashboardUsers
    .map((u) => u.userId)
    .filter((id): id is string => id !== null);

  const windowStartUtc = new Date(`${dates[0]}T00:00:00.000Z`);
  const { daily, lastLogin, totalOutreach } = await fetchActivityDashboardData(
    userIds,
    windowStartUtc
  );

  const body = buildActivityDashboardResponse(
    dashboardUsers,
    dates,
    daily,
    lastLogin,
    totalOutreach
  );

  return NextResponse.json(body);
}
