"use client";

import { useCallback, useRef, useState } from "react";

interface NotesEditorProps {
  entityId: string;
  initialNotes: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function NotesEditor({ entityId, initialNotes }: NotesEditorProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const lastSavedRef = useRef(initialNotes);

  const save = useCallback(
    async (value: string) => {
      if (value === lastSavedRef.current) return;
      setSaveState("saving");
      try {
        const res = await fetch(
          `/api/contacts/${encodeURIComponent(entityId)}/notes`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: value }),
          }
        );
        if (!res.ok) throw new Error("Save failed");
        lastSavedRef.current = value;
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch {
        setSaveState("error");
      }
    },
    [entityId]
  );

  return (
    <div className="mt-4 pt-4 border-t border-bisque-50">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-bisque-500 uppercase tracking-wide">
          Notes
        </h3>
        <span
          className={`text-xs transition-opacity ${
            saveState === "saving"
              ? "text-bisque-400 opacity-100"
              : saveState === "saved"
              ? "text-emerald-500 opacity-100"
              : saveState === "error"
              ? "text-red-500 opacity-100"
              : "opacity-0"
          }`}
        >
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
            ? "Saved"
            : saveState === "error"
            ? "Save failed"
            : ""}
        </span>
      </div>
      <textarea
        className="w-full min-h-[100px] rounded-lg border border-bisque-100 bg-bisque-50 px-3 py-2 text-sm text-bisque-800 placeholder:text-bisque-300 focus:outline-none focus:ring-2 focus:ring-bisque-300 focus:border-bisque-300 resize-y transition-colors"
        placeholder="Add notes…"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaveState("idle");
        }}
        onBlur={() => save(notes)}
      />
    </div>
  );
}
