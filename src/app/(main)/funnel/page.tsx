"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Funnel Calculator
// Plan outreach from ARR target to first calls per week.
// ---------------------------------------------------------------------------

interface FunnelInputs {
  arrTargetK: number;         // ARR target in $K
  avgDealSizeK: number;       // Average deal size in $K
  salesCycleDays: number;     // Sales cycle length in days
  closeRate: number;          // % of qualified opps that close
  meetToOppRate: number;      // % of first meetings that become qualified opps
  connectToMeetRate: number;  // % of connects (calls/emails) that book a first meeting
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
  const { arrTargetK, avgDealSizeK, salesCycleDays, closeRate, meetToOppRate, connectToMeetRate } = inputs;

  // Deals needed per year to hit ARR target
  const dealsNeeded = avgDealSizeK > 0 ? arrTargetK / avgDealSizeK : 0;

  // Weeks in a sales cycle — pipeline must be full enough to close deals
  // We annualize: deals closed per year = deals needed
  const weeksInYear = 52;
  const dealsPerWeek = dealsNeeded / weeksInYear;

  // Work backwards through funnel
  const closeRateFrac = Math.max(0.001, closeRate / 100);
  const meetToOppFrac = Math.max(0.001, meetToOppRate / 100);
  const connectToMeetFrac = Math.max(0.001, connectToMeetRate / 100);

  const oppsPerWeek = dealsPerWeek / closeRateFrac;
  const firstMeetingsPerWeek = oppsPerWeek / meetToOppFrac;
  const connectsPerWeek = firstMeetingsPerWeek / connectToMeetFrac;

  // Total pipeline volumes (annualized)
  const oppsNeeded = oppsPerWeek * weeksInYear;
  const firstMeetingsNeeded = firstMeetingsPerWeek * weeksInYear;
  const connectsNeeded = connectsPerWeek * weeksInYear;

  return {
    dealsNeeded,
    oppsNeeded,
    firstMeetingsNeeded,
    connectsNeeded,
    dealsPerWeek,
    oppsPerWeek,
    firstMeetingsPerWeek,
    connectsPerWeek,
  };
}

function fmt(n: number, decimals = 1): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPer(n: number): string {
  // Show per-week as fractional if < 1, else 1 decimal
  if (n < 1) return fmt(n, 2);
  return fmt(n, 1);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-bisque-800">{label}</label>
      {hint && <p className="text-xs text-bisque-500">{hint}</p>}
      <div className="flex items-center gap-1">
        {prefix && (
          <span className="text-bisque-600 text-sm font-medium">{prefix}</span>
        )}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          className="w-full px-3 py-2 rounded-lg border border-bisque-200 bg-white text-bisque-900 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400"
        />
        {suffix && (
          <span className="text-bisque-600 text-sm font-medium">{suffix}</span>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  annual,
  weekly,
  color,
}: {
  label: string;
  annual: number;
  weekly: number;
  color: string;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-1 ${color}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-3xl font-bold">{fmtPer(weekly)}<span className="text-base font-normal opacity-60">/wk</span></p>
      <p className="text-sm opacity-60">{fmt(annual, 0)} per year</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const DEFAULTS: FunnelInputs = {
  arrTargetK: 1000,       // $1M ARR
  avgDealSizeK: 100,      // $100K avg deal
  salesCycleDays: 90,     // 90-day cycle
  closeRate: 25,          // 25% close rate
  meetToOppRate: 40,      // 40% of meetings become opps
  connectToMeetRate: 10,  // 10% connect-to-meeting rate
};

export default function FunnelPage() {
  const [inputs, setInputs] = useState<FunnelInputs>(DEFAULTS);

  function set<K extends keyof FunnelInputs>(key: K, value: FunnelInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  const out = calcFunnel(inputs);
  const dealsNeeded = Math.ceil(out.dealsNeeded);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-bisque-900">Funnel Calculator</h1>
        <p className="text-bisque-600 mt-1 text-sm">
          Set your ARR target and conversion rates to find out how many first calls you need per week.
        </p>
      </div>

      {/* Inputs */}
      <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-6 space-y-6">
        <h2 className="text-lg font-semibold text-bisque-800">Targets &amp; Deal Economics</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <NumberInput
            label="ARR Target"
            value={inputs.arrTargetK}
            onChange={(v) => set("arrTargetK", v)}
            min={0}
            step={100}
            prefix="$"
            suffix="K"
            hint="Annual Recurring Revenue goal"
          />
          <NumberInput
            label="Average Deal Size"
            value={inputs.avgDealSizeK}
            onChange={(v) => set("avgDealSizeK", v)}
            min={1}
            step={10}
            prefix="$"
            suffix="K"
            hint="ACV per closed deal"
          />
          <NumberInput
            label="Sales Cycle"
            value={inputs.salesCycleDays}
            onChange={(v) => set("salesCycleDays", v)}
            min={1}
            suffix="days"
            hint="Average days from first call to close"
          />
        </div>

        <h2 className="text-lg font-semibold text-bisque-800 pt-2">Conversion Rates</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <NumberInput
            label="Close Rate"
            value={inputs.closeRate}
            onChange={(v) => set("closeRate", Math.min(100, Math.max(0, v)))}
            min={0}
            max={100}
            step={5}
            suffix="%"
            hint="Qualified opps → closed won"
          />
          <NumberInput
            label="Meeting → Opp Rate"
            value={inputs.meetToOppRate}
            onChange={(v) => set("meetToOppRate", Math.min(100, Math.max(0, v)))}
            min={0}
            max={100}
            step={5}
            suffix="%"
            hint="First meetings → qualified opps"
          />
          <NumberInput
            label="Connect → Meeting Rate"
            value={inputs.connectToMeetRate}
            onChange={(v) => set("connectToMeetRate", Math.min(100, Math.max(0, v)))}
            min={0}
            max={100}
            step={1}
            suffix="%"
            hint="Outreach touches → first meetings"
          />
        </div>
      </div>

      {/* Summary headline */}
      <div className="bg-bisque-800 text-bisque-50 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1">
          <p className="text-bisque-300 text-sm font-medium">To hit</p>
          <p className="text-3xl font-bold">${inputs.arrTargetK.toLocaleString()}K ARR</p>
          <p className="text-bisque-300 text-sm mt-1">
            you need to close <strong className="text-bisque-50">{dealsNeeded} deals</strong> at $
            {inputs.avgDealSizeK.toLocaleString()}K each
          </p>
        </div>
        <div className="flex-shrink-0 bg-bisque-700 rounded-xl px-6 py-4 text-center">
          <p className="text-bisque-300 text-xs font-semibold uppercase tracking-wide">First calls needed</p>
          <p className="text-5xl font-bold text-bisque-50 mt-1">{fmtPer(out.connectsPerWeek)}</p>
          <p className="text-bisque-300 text-sm">per week</p>
        </div>
      </div>

      {/* Funnel breakdown */}
      <div>
        <h2 className="text-lg font-semibold text-bisque-800 mb-4">Funnel Breakdown</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard
            label="Outreach Connects"
            annual={out.connectsNeeded}
            weekly={out.connectsPerWeek}
            color="bg-bisque-100 text-bisque-800 border-bisque-200"
          />
          <MetricCard
            label="First Meetings"
            annual={out.firstMeetingsNeeded}
            weekly={out.firstMeetingsPerWeek}
            color="bg-sky-50 text-sky-800 border-sky-200"
          />
          <MetricCard
            label="Qualified Opps"
            annual={out.oppsNeeded}
            weekly={out.oppsPerWeek}
            color="bg-violet-50 text-violet-800 border-violet-200"
          />
          <MetricCard
            label="Closed Deals"
            annual={out.dealsNeeded}
            weekly={out.dealsPerWeek}
            color="bg-emerald-50 text-emerald-800 border-emerald-200"
          />
        </div>
      </div>

      {/* Assumptions callout */}
      <div className="bg-bisque-50 border border-bisque-200 rounded-xl px-5 py-4 text-sm text-bisque-600">
        <strong className="text-bisque-800">How this works:</strong> The calculator starts from your ARR target, divides by average deal size to get deals needed per year, then works backwards through each conversion stage to find the weekly outreach volume required. Sales cycle length is shown for context — longer cycles mean you need pipeline running further in advance.
      </div>
    </div>
  );
}
