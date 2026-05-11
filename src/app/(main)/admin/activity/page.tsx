export const metadata = {
  title: "Activity — Eloso Bisque",
};

export const dynamic = "force-dynamic";

interface UserActivity {
  email: string;
  name: string;
  last_login: string | null;
  last_7_days_logins: number[];
  last_7_days_outreach_sent: number[];
  total_outreach_sent: number;
}

interface ActivityData {
  users: UserActivity[];
  dates: string[];
}

async function fetchActivity(): Promise<ActivityData | null> {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ?? "https://eloso-bisque.vercel.app";
    const res = await fetch(`${base}/api/admin/activity`, {
      headers: process.env.LOBSTER_INTERNAL_SECRET
        ? { "X-Internal-Secret": process.env.LOBSTER_INTERNAL_SECRET }
        : {},
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<ActivityData>;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function DayCell({ value }: { value: number }) {
  const bg =
    value === 0
      ? "bg-bisque-50 text-bisque-300"
      : value < 3
      ? "bg-blue-50 text-blue-600"
      : value < 8
      ? "bg-blue-100 text-blue-700"
      : "bg-blue-200 text-blue-800";
  return (
    <td className={`text-center text-sm font-medium px-2 py-2 ${bg}`}>
      {value === 0 ? "—" : value}
    </td>
  );
}

export default async function ActivityPage() {
  const data = await fetchActivity();

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-bisque-900 mb-4">
          Activity Dashboard
        </h1>
        <p className="text-bisque-600 italic text-sm">
          Could not load activity data.
        </p>
      </div>
    );
  }

  const { users, dates } = data;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-bisque-900">
          Activity Dashboard
        </h1>
        <p className="text-sm text-bisque-500 mt-1">
          Login and outreach activity per user · last 7 days
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {users.map((u) => (
          <div
            key={u.email}
            className="bg-white border border-bisque-100 rounded-xl shadow p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold text-bisque-900 text-lg">{u.name}</p>
              <span className="text-xs text-bisque-400">{u.email}</span>
            </div>
            <div className="text-sm text-bisque-600">
              <span className="font-medium text-bisque-800">
                {u.last_7_days_logins.reduce((a, b) => a + b, 0)}
              </span>{" "}
              logins this week
            </div>
            <div className="text-sm text-bisque-600">
              <span className="font-medium text-bisque-800">
                {u.last_7_days_outreach_sent.reduce((a, b) => a + b, 0)}
              </span>{" "}
              sent this week
            </div>
            <div className="text-sm text-bisque-600">
              <span className="font-medium text-bisque-800">
                {u.total_outreach_sent}
              </span>{" "}
              sent all-time
            </div>
            {u.last_login ? (
              <p className="text-xs text-bisque-400">
                Last login: {formatDate(u.last_login)}
              </p>
            ) : (
              <p className="text-xs text-bisque-400 italic">No login recorded yet</p>
            )}
          </div>
        ))}
      </div>

      {/* Logins table */}
      <section>
        <h2 className="text-lg font-semibold text-bisque-800 mb-3">
          Logins — last 7 days
        </h2>
        <div className="overflow-x-auto rounded-xl border border-bisque-100 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bisque-50 border-b border-bisque-100">
                <th className="text-left px-4 py-2.5 font-semibold text-bisque-700">
                  User
                </th>
                {dates.map((d) => (
                  <th
                    key={d}
                    className="text-center px-2 py-2.5 font-semibold text-bisque-700 min-w-[52px]"
                  >
                    {shortDate(d)}
                  </th>
                ))}
                <th className="text-center px-3 py-2.5 font-semibold text-bisque-700">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bisque-50">
              {users.map((u) => (
                <tr key={u.email} className="bg-white hover:bg-bisque-50/50">
                  <td className="px-4 py-2.5 font-medium text-bisque-900">
                    {u.name}
                  </td>
                  {u.last_7_days_logins.map((v, i) => (
                    <DayCell key={dates[i]} value={v} />
                  ))}
                  <td className="text-center px-3 py-2.5 font-semibold text-bisque-800">
                    {u.last_7_days_logins.reduce((a, b) => a + b, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Outreach sent table */}
      <section>
        <h2 className="text-lg font-semibold text-bisque-800 mb-3">
          Outreach sent — last 7 days
        </h2>
        <div className="overflow-x-auto rounded-xl border border-bisque-100 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bisque-50 border-b border-bisque-100">
                <th className="text-left px-4 py-2.5 font-semibold text-bisque-700">
                  User
                </th>
                {dates.map((d) => (
                  <th
                    key={d}
                    className="text-center px-2 py-2.5 font-semibold text-bisque-700 min-w-[52px]"
                  >
                    {shortDate(d)}
                  </th>
                ))}
                <th className="text-center px-3 py-2.5 font-semibold text-bisque-700">
                  Week
                </th>
                <th className="text-center px-3 py-2.5 font-semibold text-bisque-700">
                  All-time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bisque-50">
              {users.map((u) => (
                <tr key={u.email} className="bg-white hover:bg-bisque-50/50">
                  <td className="px-4 py-2.5 font-medium text-bisque-900">
                    {u.name}
                  </td>
                  {u.last_7_days_outreach_sent.map((v, i) => (
                    <DayCell key={dates[i]} value={v} />
                  ))}
                  <td className="text-center px-3 py-2.5 font-semibold text-bisque-800">
                    {u.last_7_days_outreach_sent.reduce((a, b) => a + b, 0)}
                  </td>
                  <td className="text-center px-3 py-2.5 font-semibold text-bisque-700">
                    {u.total_outreach_sent}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-bisque-400 mt-2">
          Counts each "Mark Sent" action per user. Historical data accumulates
          from the time this feature was deployed.
        </p>
      </section>
    </div>
  );
}
