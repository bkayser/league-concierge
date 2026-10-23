"use client";

import { useState } from "react";

export interface AdminUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

type Step = "email" | "code" | "profile";

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600";
const BUTTON_CLASS =
  "w-full rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

async function postJson(
  url: string,
  body: unknown,
  method = "POST",
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

// Email one-time-code sign-in, followed by a one-time profile form for
// admins who have not yet given their name and phone number. When
// `pendingProfileUser` is set the flow starts at the profile step (an
// existing session whose profile is incomplete).
export default function AdminLogin({
  pendingProfileUser,
  onAuthenticated,
}: {
  pendingProfileUser: AdminUser | null;
  onAuthenticated: (user: AdminUser) => void;
}) {
  const [step, setStep] = useState<Step>(pendingProfileUser ? "profile" : "email");
  const [email, setEmail] = useState(pendingProfileUser?.email ?? "");
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState(pendingProfileUser?.first_name ?? "");
  const [lastName, setLastName] = useState(pendingProfileUser?.last_name ?? "");
  const [phone, setPhone] = useState(pendingProfileUser?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await postJson("/api/admin/auth/request", { email });
      if (!res.ok) {
        setError(String(res.data.error ?? `Request failed (HTTP ${res.status}).`));
        return;
      }
      setStep("code");
      setCode("");
      setNotice(
        `If ${email} is an authorized admin address, a 6-digit code is on its way.`,
      );
    } catch {
      setError("Could not connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await postJson("/api/admin/auth/verify", { email, code });
      if (!res.ok) {
        setError(String(res.data.error ?? `Verification failed (HTTP ${res.status}).`));
        return;
      }
      const user = res.data.user as AdminUser;
      if (res.data.profileComplete) {
        onAuthenticated(user);
      } else {
        setFirstName(user.first_name ?? "");
        setLastName(user.last_name ?? "");
        setPhone(user.phone ?? "");
        setNotice(null);
        setStep("profile");
      }
    } catch {
      setError("Could not connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await postJson(
        "/api/admin/me",
        { firstName, lastName, phone },
        "PUT",
      );
      if (!res.ok) {
        setError(String(res.data.error ?? `Save failed (HTTP ${res.status}).`));
        return;
      }
      onAuthenticated(res.data.user as AdminUser);
    } catch {
      setError("Could not connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const subtitle =
    step === "email"
      ? "Enter your email to receive a sign-in code."
      : step === "code"
        ? "Enter the code from your email."
        : "Welcome! Tell us who you are to finish setting up your account.";

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">
            OYSA Document Admin
          </h1>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>

        {step === "email" && (
          <form onSubmit={requestCode} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                autoComplete="email"
                required
                className={INPUT_CLASS}
                placeholder="you@example.org"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={loading || !email} className={BUTTON_CLASS}>
              {loading ? "Sending…" : "Send code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verifyCode} className="space-y-4">
            {notice && <p className="text-sm text-gray-600">{notice}</p>}
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
                Sign-in code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ""));
                  setError(null);
                }}
                autoComplete="one-time-code"
                required
                className={`${INPUT_CLASS} tracking-widest text-center font-mono`}
                placeholder="123456"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className={BUTTON_CLASS}
            >
              {loading ? "Verifying…" : "Sign in"}
            </button>
            <div className="flex justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError(null);
                  setNotice(null);
                }}
                className="text-gray-500 hover:text-gray-800 transition-colors"
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={() => void requestCode()}
                disabled={loading}
                className="text-green-700 hover:text-green-900 disabled:opacity-50 transition-colors"
              >
                Resend code
              </button>
            </div>
          </form>
        )}

        {step === "profile" && (
          <form onSubmit={saveProfile} className="space-y-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                First name
              </label>
              <input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
                maxLength={100}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
                Last name
              </label>
              <input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
                maxLength={100}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                Phone number
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                required
                className={INPUT_CLASS}
                placeholder="(503) 555-0123"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || !firstName.trim() || !lastName.trim() || !phone.trim()}
              className={BUTTON_CLASS}
            >
              {loading ? "Saving…" : "Continue"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
