"use client";

import { useState, useEffect, useRef } from "react";

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultKind?: "person" | "org";
}

interface FormState {
  name: string;
  email: string;
  organization: string;
  linkedin_url: string;
  kind: "person" | "org";
}

export default function AddContactModal({
  isOpen,
  onClose,
  onSuccess,
  defaultKind = "person",
}: AddContactModalProps) {
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    organization: "",
    linkedin_url: "",
    kind: defaultKind,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setForm({
        name: "",
        email: "",
        organization: "",
        linkedin_url: "",
        kind: defaultKind,
      });
      setError(null);
      setSaving(false);
      // Focus the first input after a short delay for animation
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [isOpen, defaultKind]);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !saving) onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name && !form.email && !form.organization) {
      setError("Please fill in at least one field.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/contacts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSaving(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 rounded-lg border border-bisque-200 bg-white text-bisque-900 placeholder-bisque-400 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400 disabled:opacity-50";
  const labelCls = "block text-xs font-medium text-bisque-700 mb-1";

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />

      {/* Modal panel */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-bisque-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bisque-100">
          <h2 className="text-lg font-semibold text-bisque-900">Add New Contact</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-bisque-400 hover:text-bisque-700 transition-colors disabled:opacity-50 text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Type toggle */}
          <div>
            <span className={labelCls}>Type</span>
            <div className="flex gap-2">
              {(["person", "org"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={saving}
                  onClick={() => setForm((f) => ({ ...f, kind: k }))}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                    form.kind === k
                      ? "bg-bisque-700 text-bisque-50"
                      : "bg-bisque-100 text-bisque-800 hover:bg-bisque-200"
                  }`}
                >
                  {k === "person" ? "Person" : "Organization"}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className={labelCls} htmlFor="ac-name">
              Name
            </label>
            <input
              ref={firstInputRef}
              id="ac-name"
              type="text"
              placeholder={form.kind === "person" ? "Jane Doe" : "Acme Corp"}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={saving}
              className={inputCls}
            />
          </div>

          {/* Email — only for people */}
          {form.kind === "person" && (
            <div>
              <label className={labelCls} htmlFor="ac-email">
                Email
              </label>
              <input
                id="ac-email"
                type="email"
                placeholder="jane@example.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                disabled={saving}
                className={inputCls}
              />
            </div>
          )}

          {/* Organization — only for people */}
          {form.kind === "person" && (
            <div>
              <label className={labelCls} htmlFor="ac-org">
                Organization
              </label>
              <input
                id="ac-org"
                type="text"
                placeholder="Acme Corp"
                value={form.organization}
                onChange={(e) =>
                  setForm((f) => ({ ...f, organization: e.target.value }))
                }
                disabled={saving}
                className={inputCls}
              />
            </div>
          )}

          {/* LinkedIn URL */}
          <div>
            <label className={labelCls} htmlFor="ac-linkedin">
              LinkedIn URL
            </label>
            <input
              id="ac-linkedin"
              type="text"
              placeholder="https://linkedin.com/in/janedoe"
              value={form.linkedin_url}
              onChange={(e) =>
                setForm((f) => ({ ...f, linkedin_url: e.target.value }))
              }
              disabled={saving}
              className={inputCls}
            />
          </div>

          {/* AI enrichment notice */}
          <p className="text-xs text-bisque-500 italic">
            AI will infer any missing fields before saving.
          </p>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-bisque-100 text-bisque-800 rounded-lg text-sm font-medium hover:bg-bisque-200 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-bisque-700 text-bisque-50 rounded-lg text-sm font-medium hover:bg-bisque-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-bisque-200 border-t-bisque-50 rounded-full animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
