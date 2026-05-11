import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const USERS = [
  { email: "drew@eloso.ai", name: "Drew" },
  { email: "ben@eloso.ai", name: "Ben" },
  { email: "jake@eloso.ai", name: "Jake" },
];

const DAYS = 7;

function getDates(count: number): string[] {
  const dates: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

export async function GET() {
  const dates = getDates(DAYS);

  const users = await Promise.all(
    USERS.map(async ({ email, name }) => {
      // Fetch last login timestamp
      const lastLogin = await kv.get<string>(`activity:last_login:${email}`);

      // Fetch all-time total outreach sent
      const totalOutreachSent =
        (await kv.get<number>(`activity:outreach_sent_total:${email}`)) ?? 0;

      // Fetch per-day counts in parallel
      const [dailyLogins, dailyOutreachSent] = await Promise.all([
        Promise.all(
          dates.map((date) =>
            kv
              .get<number>(`activity:logins:${email}:${date}`)
              .then((v) => v ?? 0)
          )
        ),
        Promise.all(
          dates.map((date) =>
            kv
              .get<number>(`activity:outreach_sent:${email}:${date}`)
              .then((v) => v ?? 0)
          )
        ),
      ]);

      return {
        email,
        name,
        last_login: lastLogin ?? null,
        last_7_days_logins: dailyLogins,
        last_7_days_outreach_sent: dailyOutreachSent,
        total_outreach_sent: totalOutreachSent,
      };
    })
  );

  return NextResponse.json({ users, dates });
}
