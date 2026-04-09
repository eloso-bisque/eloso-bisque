import Link from "next/link";

interface ContactCardProps {
  id: string;
  name: string;
  title?: string;
  org?: string;
  kind: string;
  tags: string[];
  score?: number;
}

function ScoreBadge({ score }: { score: number }) {
  let cls: string;
  if (score >= 70) {
    cls = "bg-green-100 text-green-700 border border-green-200";
  } else if (score >= 40) {
    cls = "bg-yellow-100 text-yellow-700 border border-yellow-200";
  } else {
    cls = "bg-red-100 text-red-600 border border-red-200";
  }
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${cls}`}
      title={`Eloso fit score: ${score}/100`}
    >
      {score}
    </span>
  );
}

function AvatarInitial({ name, kind }: { name: string; kind: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const bg =
    kind === "person"
      ? "bg-sky-100 text-sky-700"
      : "bg-violet-100 text-violet-700";
  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${bg}`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

export default function ContactCard({
  id,
  name,
  title,
  org,
  kind,
  tags,
  score,
}: ContactCardProps) {
  const fitTag = tags.find((t) => t.startsWith("fit-"));
  const fitLabel = fitTag ? fitTag.replace("fit-", "") : null;
  const fitColors: Record<string, string> = {
    high: "bg-green-100 text-green-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-bisque-100 text-bisque-600",
  };

  return (
    <Link
      href={`/contacts/${encodeURIComponent(id)}`}
      className="flex items-center gap-3 bg-white rounded-xl border border-bisque-100 shadow-sm px-4 py-3 min-h-[68px] active:bg-bisque-50 transition-colors"
    >
      <AvatarInitial name={name} kind={kind} />

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-bisque-900 text-base leading-tight truncate">
          {name}
        </p>
        {(title || org) && (
          <p className="text-sm text-bisque-500 mt-0.5 truncate">
            {[title, org].filter(Boolean).join(" · ")}
          </p>
        )}
        {fitLabel && (
          <span
            className={`inline-block mt-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${fitColors[fitLabel] ?? fitColors.high}`}
          >
            {fitLabel} fit
          </span>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        {score !== undefined && <ScoreBadge score={score} />}
        <span className="text-bisque-300 text-sm" aria-hidden="true">
          →
        </span>
      </div>
    </Link>
  );
}
