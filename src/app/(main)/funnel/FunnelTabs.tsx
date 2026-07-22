"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { FunnelKanbanBoard } from "@/lib/funnel-stage";

// Lazy-load the kanban to keep the server bundle lean
const FunnelKanban = dynamic(() => import("@/components/FunnelKanban"), {
  ssr: false,
  loading: () => <div className="p-8 text-bisque-400 text-sm">Loading kanban…</div>,
});

// ---------------------------------------------------------------------------
// Funnel Calculator (extracted from the original page.tsx)
// ---------------------------------------------------------------------------

interface FunnelInputs {
  arrTargetK: number;
  avgDealSizeK: number;
  salesCycleDays: number;
  closeRate: number;
  meetToOppRate: number;
  connectToMeetRate: number;
}

interface FunnelOutputs {
  dealsNeeded: number;
  oppsNeeded: number;
  firstMeetingsNeeded: number;
  connectsNeeded: number;
  dealsPerWeek: number;
  oppsPerWeek: number;
  firstMeetingsPerWeek: number;
  connectsPerWeek: number;
}

function calcFunnel(inputs: FunnelInputs): FunnelOutputs {
  const { arrTargetK, avgDealSizeK, salesCycleDays: _salesCycleDays, closeRate, meetToOppRate, connectToMeetRate } = inputs;
  const dealsNeeded = avgDealSizeK > 0 ? arrTargetK / avgDealSizeK : 0;
  const weeksInYear = 52;
  const dealsPerWeek = dealsNeeded / weeksInYear;
  const closeRateFrac = Math.max(0.001, closeRate / 100);
  const meetToOppFrac = Math.max(0.001, meetToOppRate / 100);
  const connectToMeetFrac = Math.max(0.001, connectToMeetRate / 100);
  const oppsPerWeek = dealsPerWeek / closeRateFrac;
  const firstMeetingsPerWeek = oppsPerWeek / meetToOppFrac;
  const connectsPerWeek = firstMeetingsPerWeek / connectToMeetFrac;
  return {
    dealsNeeded,
    oppsNeeded: oppsPerWeek * weeksInYear,
    firstMeetingsNeeded: firstMeetingsPerWeek * weeksInYear,
    connectsNeeded: connectsPerWeek * weeksInYear,
    dealsPerWeek,
    oppsPerWeek,
    firstMeetingsPerWeek,
    connectsPerWeek,
  };
}

function fmt(n: number, decimals = 1): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPer(n: number): string { return n < 1 ? fmt(n, 2) : fmt(n, 1); }

function NumberInput({
  label, value, onChange, min, max, step, prefix, suffix, hint,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; prefix?: string; suffix?: string; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-bisque-800">{label}</label>
      {hint && <p className="text-xs text-bisque-500">{hint}</p>}
      <div className="flex items-center gap-1">
        {prefix && <span className="text-bisque-600 text-sm font-medium">{prefix}</span>}
        <input
          type="number" value={value} min={min} max={max} step={step ?? 1}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
          className="w-full px-3 py-2 rounded-lg border border-bisque-200 bg-white text-bisque-900 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400"
        />
        {suffix && <span className="text-bisque-600 text-sm font-medium">{suffix}</span>}
      </div>
    </div>
  );
}

function MetricCard({ label, annual, weekly, color }: { label: string; annual: number; weekly: number; color: string }) {
  return (
    <div className={`rounded-xl border p-4 space-y-1 ${color}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-3xl font-bold">{fmtPer(weekly)}<span className="text-base font-normal opacity-60">/wk</span></p>
      <p className="text-sm opacity-60">{fmt(annual, 0)} per year</p>
    </div>
  );
}

const DEFAULTS: FunnelInputs = {
  arrTargetK: 1000,
  avgDealSizeK: 100,
  salesCycleDays: 90,
  closeRate: 25,
  meetToOppRate: 40,
  connectToMeetRate: 10,
};

function FunnelCalculator() {
  const [inputs, setInputs] = useState<FunnelInputs>(DEFAULTS);
  function set<K extends keyof FunnelInputs>(key: K, value: FunnelInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }
  const out = calcFunnel(inputs);
  const dealsNeeded = Math.ceil(out.dealsNeeded);

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-6 space-y-6">
        <h2 className="text-lg font-semibold text-bisque-800">Targets &amp; Deal Economics</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <NumberInput label="ARR Target" value={inputs.arrTargetK} onChange={(v) => set("arrTargetK", v)} min={0} step={100} prefix="$" suffix="K" hint="Annual Recurring Revenue goal" />
          <NumberInput label="Average Deal Size" value={inputs.avgDealSizeK} onChange={(v) => set("avgDealSizeK", v)} min={1} step={10} prefix="$" suffix="K" hint="ACV per closed deal" />
          <NumberInput label="Sales Cycle" value={inputs.salesCycleDays} onChange={(v) => set("salesCycleDays", v)} min={1} suffix="days" hint="Average days from first call to close" />
        </div>
        <h2 className="text-lg font-semibold text-bisque-800 pt-2">Conversion Rates</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <NumberInput label="Close Rate" value={inputs.closeRate} onChange={(v) => set("closeRate", Math.min(100, Math.max(0, v)))} min={0} max={100} step={5} suffix="%" hint="Qualified opps → closed won" />
          <NumberInput label="Meeting → Opp Rate" value={inputs.meetToOppRate} onChange={(v) => set("meetToOppRate", Math.min(100, Math.max(0, v)))} min={0} max={100} step={5} suffix="%" hint="First meetings → qualified opps" />
          <NumberInput label="Connect → Meeting Rate" value={inputs.connectToMeetRate} onChange={(v) => set("connectToMeetRate", Math.min(100, Math.max(0, v)))} min={0} max={100} step={1} suffix="%" hint="Outreach touches → first meetings" />
        </div>
      </div>
      <div className="bg-bisque-800 text-bisque-50 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1">
          <p className="text-bisque-300 text-sm font-medium">To hit</p>
          <p className="text-3xl font-bold">${inputs.arrTargetK.toLocaleString()}K ARR</p>
          <p className="text-bisque-300 text-sm mt-1">you need to close <strong className="text-bisque-50">{dealsNeeded} deals</strong> at ${inputs.avgDealSizeK.toLocaleString()}K each</p>
        </div>
        <div className="flex-shrink-0 bg-bisque-700 rounded-xl px-6 py-4 text-center">
          <p className="text-bisque-300 text-xs font-semibold uppercase tracking-wide">First calls needed</p>
          <p className="text-5xl font-bold text-bisque-50 mt-1">{fmtPer(out.connectsPerWeek)}</p>
          <p className="text-bisque-300 text-sm">per week</p>
        </div>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-bisque-800 mb-4">Funnel Breakdown</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard label="Outreach Connects" annual={out.connectsNeeded} weekly={out.connectsPerWeek} color="bg-bisque-100 text-bisque-800 border-bisque-200" />
          <MetricCard label="First Meetings" annual={out.firstMeetingsNeeded} weekly={out.firstMeetingsPerWeek} color="bg-sky-50 text-sky-800 border-sky-200" />
          <MetricCard label="Qualified Opps" annual={out.oppsNeeded} weekly={out.oppsPerWeek} color="bg-violet-50 text-violet-800 border-violet-200" />
          <MetricCard label="Closed Deals" annual={out.dealsNeeded} weekly={out.dealsPerWeek} color="bg-emerald-50 text-emerald-800 border-emerald-200" />
        </div>
      </div>
      <div className="bg-bisque-50 border border-bisque-200 rounded-xl px-5 py-4 text-sm text-bisque-600">
        <strong className="text-bisque-800">How this works:</strong> The calculator starts from your ARR target, divides by average deal size to get deals needed per year, then works backwards through each conversion stage to find the weekly outreach volume required.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab shell
// ---------------------------------------------------------------------------

type Tab = "kanban" | "calculator";

interface FunnelTabsProps {
  initialKanbanData: FunnelKanbanBoard;
}

export default function FunnelTabs({ initialKanbanData }: FunnelTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("kanban");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-bisque-900">Funnel</h1>
        <p className="text-bisque-600 mt-1 text-sm">Manage your sales pipeline and model conversion rates.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-bisque-100 p-1 rounded-xl w-fit">
        {(["kanban", "calculator"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              activeTab === tab
                ? "bg-white text-bisque-900 shadow-sm"
                : "text-bisque-600 hover:text-bisque-900"
            }`}
          >
            {tab === "kanban" ? "Pipeline" : "Calculator"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "kanban" ? (
        <FunnelKanban initialData={initialKanbanData} />
      ) : (
        <FunnelCalculator />
      )}
    </div>
  );
}
