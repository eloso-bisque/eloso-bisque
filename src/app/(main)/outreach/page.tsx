import OutreachTabs from "@/components/OutreachTabs";

export const metadata = {
  title: "Outreach — Eloso Bisque",
};

export default function OutreachPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-bisque-900">Outreach</h1>
        <p className="text-sm text-bisque-500">
          Personalized LinkedIn outreach tasks for the team
        </p>
      </div>
      <OutreachTabs />
    </div>
  );
}
