"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { parseCsv, type ParsedContact } from "@/lib/csv-parse";
import type { BulkCreateResult } from "@/app/api/contacts/bulk-create/route";

interface BulkAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
}

type Stage = "input" | "preview" | "result";

export default function BulkAddModal({
  isOpen,
  onClose,
  onSuccess,
}: BulkAddModalProps) {
  const [stage, setStage] = useState<Stage>("input");
  const [csvText, setCsvText] = useState("");
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [parseErrors, setParseErrors] = useState<
    { row: number; raw: string; reason: string }[]
  >([]);
  const [kind, setKind] = useState<"person" | "org">("person");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkCreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setStage("input");
      setCsvText("");
      setContacts([]);
      setParseErrors([]);
      setKind("person");
      setSubmitting(false);
      setResult(null);
      setError(null);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !submitting) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, submitting, onClose]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        setCsvText(text ?? "");
      };
      reader.readAsText(file);
      // Reset the input so the same file can be re-selected
      e.target.value = "";
    },
    []
  );

  const handlePreview = () => {
    if (!csvText.trim()) {
      setError("Please paste CSV text or upload a file.");
      return;
    }
    setError(null);
    const parsed = parseCsv(csvText);
    setContacts(parsed.contacts);
    setParseErrors(parsed.errors);
    setStage("preview");
  };

  const handleSubmit = async () => {
    if (contacts.length === 0) {
      setError("No valid contacts to import.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/contacts/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts, kind }),
      });

      const data = (await res.json()) as BulkCreateResult;

      if (!res.ok) {
        setError("Server error. Please try again.");
        setSubmitting(false);
        return;
      }

      setResult(data);
      setStage("result");
      if (data.created > 0) {
        onSuccess(data.created);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputCls =
    "w-full px-3 py-2 rounded-lg border border-bisque-200 bg-white text-bisque-900 placeholder-bisque-400 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400 disabled:opacity-50";
  const labelCls = "block text-xs font-medium text-bisque-700 mb-1";
  const btnPrimary =
    "px-4 py-2 bg-bisque-700 text-bisque-50 rounded-lg text-sm font-medium hover:bg-bisque-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2";
  const btnSecondary =
    "px-4 py-2 bg-bisque-100 text-bisque-800 rounded-lg text-sm font-medium hover:bg-bisque-200 transition-colors disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-bisque-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bisque-100 shrink-0">
          <h2 className="text-lg font-semibold text-bisque-900">
            Bulk Add Contacts
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-bisque-400 hover:text-bisque-700 transition-colors disabled:opacity-50 text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {stage === "input" && (
            <>
              {/* Kind selector */}
              <div>
                <span className={labelCls}>Import as</span>
                <div className="flex gap-2">
                  {(["person", "org"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        kind === k
                          ? "bg-bisque-700 text-bisque-50"
                          : "bg-bisque-100 text-bisque-800 hover:bg-bisque-200"
                      }`}
                    >
                      {k === "person" ? "People" : "Organizations"}
                    </button>
                  ))}
                </div>
              </div>

              {/* File upload */}
              <div>
                <label className={labelCls}>Upload CSV file</label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
                  className="block w-full text-sm text-bisque-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-bisque-100 file:text-bisque-800 hover:file:bg-bisque-200 cursor-pointer"
                />
              </div>

              <div className="flex items-center gap-3">
                <hr className="flex-1 border-bisque-100" />
                <span className="text-xs text-bisque-400">or paste below</span>
                <hr className="flex-1 border-bisque-100" />
              </div>

              {/* Textarea */}
              <div>
                <label className={labelCls} htmlFor="bulk-csv-input">
                  CSV text
                </label>
                <textarea
                  ref={textareaRef}
                  id="bulk-csv-input"
                  rows={8}
                  placeholder={
                    "name,email,organization\nAlice Smith,alice@example.com,Acme Corp\nBob Jones,bob@example.com,"
                  }
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  className={`${inputCls} font-mono resize-y`}
                />
                <p className="text-xs text-bisque-400 mt-1">
                  Columns: <code>name</code>, <code>email</code>,{" "}
                  <code>organization</code> — headers optional, blank rows
                  skipped.
                </p>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}
            </>
          )}

          {stage === "preview" && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-bisque-700">
                  <span className="font-semibold text-bisque-900">
                    {contacts.length}
                  </span>{" "}
                  contact{contacts.length !== 1 ? "s" : ""} ready to import
                  {parseErrors.length > 0 && (
                    <span className="ml-2 text-amber-600">
                      ({parseErrors.length} row
                      {parseErrors.length !== 1 ? "s" : ""} skipped)
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => setStage("input")}
                  className="text-xs text-bisque-500 hover:text-bisque-700 underline"
                >
                  Edit
                </button>
              </div>

              {/* Preview table */}
              <div className="rounded-xl border border-bisque-100 overflow-hidden">
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-bisque-50 border-b border-bisque-100">
                        <th className="text-left px-3 py-2 font-semibold text-bisque-800">
                          Name
                        </th>
                        <th className="text-left px-3 py-2 font-semibold text-bisque-800">
                          Email
                        </th>
                        <th className="text-left px-3 py-2 font-semibold text-bisque-800">
                          Organization
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((c, i) => (
                        <tr
                          key={i}
                          className={`border-b border-bisque-50 ${
                            i % 2 === 0 ? "" : "bg-bisque-50/30"
                          }`}
                        >
                          <td className="px-3 py-2 text-bisque-900">
                            {c.name || <span className="text-bisque-400 italic">—</span>}
                          </td>
                          <td className="px-3 py-2 text-bisque-600">
                            {c.email || <span className="text-bisque-300">—</span>}
                          </td>
                          <td className="px-3 py-2 text-bisque-600">
                            {c.organization || <span className="text-bisque-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Parse errors */}
              {parseErrors.length > 0 && (
                <details className="text-xs text-amber-700">
                  <summary className="cursor-pointer font-medium">
                    {parseErrors.length} skipped row
                    {parseErrors.length !== 1 ? "s" : ""} (click to expand)
                  </summary>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    {parseErrors.map((e) => (
                      <li key={e.row}>
                        Row {e.row}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}
            </>
          )}

          {stage === "result" && result && (
            <div className="space-y-4 py-2">
              <div
                className={`rounded-xl p-4 ${
                  result.errors.length === 0
                    ? "bg-green-50 border border-green-100"
                    : "bg-amber-50 border border-amber-100"
                }`}
              >
                <p
                  className={`font-semibold text-base ${
                    result.errors.length === 0
                      ? "text-green-800"
                      : "text-amber-800"
                  }`}
                >
                  {result.created === 0
                    ? "No contacts were imported."
                    : `${result.created} contact${result.created !== 1 ? "s" : ""} imported successfully.`}
                </p>
                {result.skipped > 0 && (
                  <p className="text-sm text-bisque-600 mt-1">
                    {result.skipped} row{result.skipped !== 1 ? "s" : ""} skipped
                    (no name or email).
                  </p>
                )}
              </div>

              {result.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-red-700 mb-2">
                    {result.errors.length} contact
                    {result.errors.length !== 1 ? "s" : ""} failed to save:
                  </p>
                  <ul className="space-y-1">
                    {result.errors.map((e, i) => (
                      <li
                        key={i}
                        className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg"
                      >
                        <span className="font-medium">{e.name}</span>:{" "}
                        {e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-bisque-100 flex gap-3 shrink-0">
          {stage === "input" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className={btnSecondary}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePreview}
                className={`flex-1 ${btnPrimary}`}
              >
                Preview →
              </button>
            </>
          )}

          {stage === "preview" && (
            <>
              <button
                type="button"
                onClick={() => setStage("input")}
                disabled={submitting}
                className={btnSecondary}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || contacts.length === 0}
                className={`flex-1 ${btnPrimary}`}
              >
                {submitting ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-bisque-200 border-t-bisque-50 rounded-full animate-spin" />
                    Importing…
                  </>
                ) : (
                  `Import ${contacts.length} contact${contacts.length !== 1 ? "s" : ""}`
                )}
              </button>
            </>
          )}

          {stage === "result" && (
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 ${btnPrimary}`}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
