"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (res.ok) {
        router.push("/login?success=password-reset");
      } else {
        const data = await res.json();
        setError(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bisque-50">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-bisque-900 mb-2 tracking-tight">
            Invalid link
          </h1>
          <p className="text-bisque-600 text-sm mb-4">
            This reset link is missing or invalid. Please request a new one.
          </p>
          <a
            href="/login?forgot=1"
            className="text-bisque-700 text-sm font-medium hover:text-bisque-900 transition-colors"
          >
            Request a new reset link
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bisque-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-bisque-900 mb-2 tracking-tight">
          Set new password
        </h1>
        <p className="text-bisque-600 text-sm mb-6">
          Choose a new password for your account.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            autoFocus
            required
            minLength={8}
            className="w-full px-4 py-2.5 border border-bisque-300 rounded-lg text-bisque-900 placeholder-bisque-400 focus:outline-none focus:ring-2 focus:ring-bisque-500 focus:border-transparent transition"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            required
            className="w-full px-4 py-2.5 border border-bisque-300 rounded-lg text-bisque-900 placeholder-bisque-400 focus:outline-none focus:ring-2 focus:ring-bisque-500 focus:border-transparent transition"
          />

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password || !confirm}
            className="w-full bg-bisque-800 hover:bg-bisque-700 disabled:bg-bisque-300 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bisque-50" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
