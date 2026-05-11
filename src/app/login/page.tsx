"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";
  const isForgot = searchParams.get("forgot") === "1";
  const successMsg = searchParams.get("success");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.push(from);
        router.refresh();
      } else {
        setError("Invalid email or password.");
        setPassword("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      setForgotSent(true);
    } catch {
      setForgotSent(true); // show success even on error — no user enumeration
    } finally {
      setForgotLoading(false);
    }
  }

  if (isForgot) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bisque-50">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-bisque-900 mb-2 tracking-tight">
            Reset password
          </h1>
          {forgotSent ? (
            <p className="text-bisque-700 text-sm">
              If that email is registered, you&apos;ll receive a reset link
              shortly.
            </p>
          ) : (
            <>
              <p className="text-bisque-600 text-sm mb-6">
                Enter your email and we&apos;ll send you a reset link.
              </p>
              <form
                onSubmit={handleForgotPassword}
                className="flex flex-col gap-4"
              >
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="you@eloso.ai"
                  autoFocus
                  required
                  className="w-full px-4 py-2.5 border border-bisque-300 rounded-lg text-bisque-900 placeholder-bisque-400 focus:outline-none focus:ring-2 focus:ring-bisque-500 focus:border-transparent transition"
                />
                <button
                  type="submit"
                  disabled={forgotLoading || !forgotEmail}
                  className="w-full bg-bisque-800 hover:bg-bisque-700 disabled:bg-bisque-300 text-white font-semibold py-2.5 rounded-lg transition-colors"
                >
                  {forgotLoading ? "Sending…" : "Send reset link"}
                </button>
              </form>
            </>
          )}
          <div className="mt-4 text-center">
            <a
              href="/login"
              className="text-bisque-600 text-sm hover:text-bisque-800 transition-colors"
            >
              Back to sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bisque-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-bisque-900 mb-2 tracking-tight">
          eloso bisque
        </h1>
        <p className="text-bisque-600 text-sm mb-6">
          Sign in to continue
        </p>

        {successMsg === "password-reset" && (
          <p className="text-green-600 text-sm mb-4">
            Password updated. Please sign in with your new password.
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@eloso.ai"
            autoFocus
            required
            className="w-full px-4 py-2.5 border border-bisque-300 rounded-lg text-bisque-900 placeholder-bisque-400 focus:outline-none focus:ring-2 focus:ring-bisque-500 focus:border-transparent transition"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            className="w-full px-4 py-2.5 border border-bisque-300 rounded-lg text-bisque-900 placeholder-bisque-400 focus:outline-none focus:ring-2 focus:ring-bisque-500 focus:border-transparent transition"
          />

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full bg-bisque-800 hover:bg-bisque-700 disabled:bg-bisque-300 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <a
            href="/login?forgot=1"
            className="text-bisque-500 text-sm hover:text-bisque-700 transition-colors"
          >
            Forgot password?
          </a>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bisque-50" />}>
      <LoginForm />
    </Suspense>
  );
}
