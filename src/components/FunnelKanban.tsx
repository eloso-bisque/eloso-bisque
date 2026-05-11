"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FUNNEL_STAGES, type FunnelContact, type FunnelKanbanData, type FunnelStage } from "@/lib/kissinger";
import { format, parseISO } from "date-fns";

// ---------------------------------------------------------------------------
// Stage config
// ---------------------------------------------------------------------------

const STAGE_COLORS: Record<FunnelStage, string> = {
  "Identified":    "bg-zinc-100 border-zinc-200",
  "Researched":    "bg-sky-50 border-sky-200",
  "Contacted":     "bg-blue-50 border-blue-200",
  "Engaged":       "bg-violet-50 border-violet-200",
  "Meeting Booked":"bg-amber-50 border-amber-200",
  "Proposal Sent": "bg-orange-50 border-orange-200",
  "Closed / Nurture": "bg-emerald-50 border-emerald-200",
};

const STAGE_HEADER_COLORS: Record<FunnelStage, string> = {
  "Identified":    "bg-zinc-200 text-zinc-800",
  "Researched":    "bg-sky-100 text-sky-800",
  "Contacted":     "bg-blue-100 text-blue-800",
  "Engaged":       "bg-violet-100 text-violet-800",
  "Meeting Booked":"bg-amber-100 text-amber-800",
  "Proposal Sent": "bg-orange-100 text-orange-800",
  "Closed / Nurture": "bg-emerald-100 text-emerald-800",
};

const STAGE_DOTS: Record<FunnelStage, string> = {
  "Identified":    "bg-zinc-400",
  "Researched":    "bg-sky-400",
  "Contacted":     "bg-blue-500",
  "Engaged":       "bg-violet-500",
  "Meeting Booked":"bg-amber-500",
  "Proposal Sent": "bg-orange-500",
  "Closed / Nurture": "bg-emerald-500",
};

// ---------------------------------------------------------------------------
// ICP score helpers (tag-based heuristic)
// ---------------------------------------------------------------------------

function getIcpTier(tags: string[]): "High" | "Med" | "Low" {
  const t = tags.map((s) => s.toLowerCase());
  if (t.includes("icp-high") || t.includes("icp:high")) return "High";
  if (t.includes("icp-med") || t.includes("icp:med")) return "Med";
  return "Low";
}

const ICP_BADGE: Record<"High" | "Med" | "Low", string> = {
  High: "bg-emerald-100 text-emerald-700",
  Med:  "bg-amber-100 text-amber-700",
  Low:  "bg-zinc-100 text-zinc-500",
};

// ---------------------------------------------------------------------------
// FunnelCard
// ---------------------------------------------------------------------------

interface FunnelCardProps {
  contact: FunnelContact;
  isDragging?: boolean;
}

function FunnelCard({ contact, isDragging }: FunnelCardProps) {
  const icp = getIcpTier(contact.tags);
  const date = (() => {
    try { return format(parseISO(contact.updatedAt), "MMM d"); } catch { return ""; }
  })();

  return (
    <div
      className={`
        rounded-lg border bg-white px-3 py-2.5 shadow-sm space-y-1
        transition-shadow
        ${isDragging ? "shadow-lg rotate-1 opacity-80" : "hover:shadow-md"}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-900 leading-tight truncate">{contact.name}</p>
        <span className={`flex-shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ${ICP_BADGE[icp]}`}>{icp}</span>
      </div>
      {contact.company && (
        <p className="text-xs text-zinc-500 truncate">{contact.company}</p>
      )}
      {contact.title && (
        <p className="text-xs text-zinc-400 truncate">{contact.title}</p>
      )}
      {date && (
        <p className="text-xs text-zinc-300 pt-0.5">{date}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable wrapper
// ---------------------------------------------------------------------------

function SortableFunnelCard({ contact }: { contact: FunnelContact }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: contact.id,
    data: { stage: contact.funnelStage, contact },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
      <FunnelCard contact={contact} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KanbanColumn
// ---------------------------------------------------------------------------

function KanbanColumn({
  stage,
  contacts,
}: {
  stage: FunnelStage;
  contacts: FunnelContact[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const ids = contacts.map((c) => c.id);

  return (
    <div className={`
      flex flex-col rounded-xl border min-w-[260px] w-[260px] shrink-0
      ${STAGE_COLORS[stage]}
      ${isOver ? "ring-2 ring-bisque-400" : ""}
    `}>
      {/* Header */}
      <div className={`flex items-center justify-between px-3 py-2 rounded-t-xl ${STAGE_HEADER_COLORS[stage]}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${STAGE_DOTS[stage]}`} />
          <span className="text-xs font-semibold uppercase tracking-wide">{stage}</span>
        </div>
        <span className="text-xs font-bold opacity-60">{contacts.length}</span>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        className="flex flex-col gap-2 p-2 flex-1 min-h-[120px]"
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {contacts.map((c) => (
            <SortableFunnelCard key={c.id} contact={c} />
          ))}
        </SortableContext>
        {contacts.length === 0 && (
          <div className="flex items-center justify-center h-16 text-xs text-zinc-300 select-none">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type IcpFilter = "All" | "High" | "Med" | "Low";

interface FilterBarProps {
  icpFilter: IcpFilter;
  onIcpFilter: (v: IcpFilter) => void;
  search: string;
  onSearch: (v: string) => void;
}

function FilterBar({ icpFilter, onIcpFilter, search, onSearch }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <input
        type="text"
        placeholder="Filter by name or company…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        className="px-3 py-1.5 rounded-lg border border-bisque-200 bg-white text-sm text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-400 w-52"
      />
      <div className="flex items-center gap-1">
        <span className="text-xs text-bisque-500 font-medium mr-1">ICP:</span>
        {(["All", "High", "Med", "Low"] as IcpFilter[]).map((tier) => (
          <button
            key={tier}
            onClick={() => onIcpFilter(tier)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              icpFilter === tier
                ? "bg-bisque-700 text-bisque-50"
                : "bg-bisque-100 text-bisque-700 hover:bg-bisque-200"
            }`}
          >
            {tier}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main FunnelKanban
// ---------------------------------------------------------------------------

interface FunnelKanbanProps {
  initialData: FunnelKanbanData;
}

export default function FunnelKanban({ initialData }: FunnelKanbanProps) {
  const [data, setData] = useState<FunnelKanbanData>(initialData);
  const [activeContact, setActiveContact] = useState<FunnelContact | null>(null);
  const [icpFilter, setIcpFilter] = useState<IcpFilter>("All");
  const [search, setSearch] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Build a flat contact lookup
  const allContacts: Record<string, FunnelContact> = {};
  for (const stage of FUNNEL_STAGES) {
    for (const c of data[stage]) {
      allContacts[c.id] = c;
    }
  }

  function findStageOfContact(id: string): FunnelStage | null {
    for (const stage of FUNNEL_STAGES) {
      if (data[stage].some((c) => c.id === id)) return stage;
    }
    return null;
  }

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const contact = allContacts[event.active.id as string];
    if (contact) setActiveContact(contact);
  }, [allContacts]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeStage = findStageOfContact(activeId);
    // over.id can be a stage (column drop zone) or a contact id
    const overStage: FunnelStage | null = (FUNNEL_STAGES as readonly string[]).includes(overId)
      ? (overId as FunnelStage)
      : findStageOfContact(overId);

    if (!activeStage || !overStage || activeStage === overStage) return;

    setData((prev) => {
      const contact = prev[activeStage].find((c) => c.id === activeId);
      if (!contact) return prev;
      return {
        ...prev,
        [activeStage]: prev[activeStage].filter((c) => c.id !== activeId),
        [overStage]: [...prev[overStage], { ...contact, funnelStage: overStage }],
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveContact(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const newStage: FunnelStage | null = (FUNNEL_STAGES as readonly string[]).includes(overId)
      ? (overId as FunnelStage)
      : findStageOfContact(overId);

    if (!newStage) return;

    // Persist to API (fire-and-forget with optimistic state already applied)
    fetch(`/api/contacts/${activeId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: newStage }),
    }).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Apply filters
  const filteredData: FunnelKanbanData = Object.fromEntries(
    FUNNEL_STAGES.map((stage) => {
      const contacts = data[stage].filter((c) => {
        if (icpFilter !== "All" && getIcpTier(c.tags) !== icpFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!c.name.toLowerCase().includes(q) && !c.company.toLowerCase().includes(q)) return false;
        }
        return true;
      });
      return [stage, contacts];
    })
  ) as FunnelKanbanData;

  return (
    <div>
      <FilterBar
        icpFilter={icpFilter}
        onIcpFilter={setIcpFilter}
        search={search}
        onSearch={setSearch}
      />

      <div className="overflow-x-auto pb-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3" style={{ minWidth: "max-content" }}>
            {FUNNEL_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                contacts={filteredData[stage]}
              />
            ))}
          </div>

          <DragOverlay>
            {activeContact ? <FunnelCard contact={activeContact} isDragging /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
