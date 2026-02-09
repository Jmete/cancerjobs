"use client";

import { useMemo, useState } from "react";

import { authClient } from "@/lib/auth-client";

type AuthMode = "sign-in" | "sign-up";

function authErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return "Authentication failed.";
}

export function AdminLoginForm() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submitLabel = useMemo(
    () => (mode === "sign-up" ? "Create account" : "Sign in"),
    [mode]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();
    const normalizedName = name.trim();

    if (!normalizedEmail || !normalizedPassword) {
      setErrorMessage("Email and password are required.");
      return;
    }

    if (mode === "sign-up" && normalizedPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      if (mode === "sign-up") {
        const { error } = await authClient.signUp.email({
          email: normalizedEmail,
          password: normalizedPassword,
          name: normalizedName || normalizedEmail.split("@")[0] || "Admin User",
        });

        if (error) {
          throw new Error(authErrorMessage(error));
        }
      } else {
        const { error } = await authClient.signIn.email({
          email: normalizedEmail,
          password: normalizedPassword,
        });

        if (error) {
          throw new Error(authErrorMessage(error));
        }
      }

      window.location.reload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOutCurrentSession() {
    setLoading(true);
    setErrorMessage(null);

    try {
      await authClient.signOut();
      window.location.reload();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not sign out session."
      );
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Admin sign in</h2>
        <div className="inline-flex rounded-md border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => setMode("sign-in")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              mode === "sign-in"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("sign-up")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              mode === "sign-up"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign up
          </button>
        </div>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        Uses Better Auth with server-managed sessions. The first signed-up user
        is automatically granted admin access.
      </p>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        {mode === "sign-up" ? (
          <label className="grid gap-1 text-sm">
            Name
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3"
              placeholder="Admin User"
            />
          </label>
        ) : null}

        <label className="grid gap-1 text-sm">
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3"
            placeholder="you@example.com"
          />
        </label>

        <label className="grid gap-1 text-sm">
          Password
          <input
            type="password"
            autoComplete={
              mode === "sign-up" ? "new-password" : "current-password"
            }
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3"
          />
        </label>

        {errorMessage ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Processing..." : submitLabel}
        </button>

        <button
          type="button"
          onClick={handleSignOutCurrentSession}
          disabled={loading}
          className="inline-flex h-10 w-full items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          Sign out current session
        </button>
      </form>
    </section>
  );
}
