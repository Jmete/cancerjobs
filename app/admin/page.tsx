import Link from "next/link";

import { AdminPanel } from "@/components/admin/admin-panel";
import { AdminLoginForm } from "@/components/admin/login-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAdminSession } from "@/lib/admin-auth";

export default async function AdminPage() {
  const adminSession = await getAdminSession();
  const authenticated = Boolean(adminSession);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
      <header className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Cancer Jobs</p>
          <h1 className="text-lg font-semibold md:text-xl">Admin</h1>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Back to map
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {authenticated ? (
        <AdminPanel adminEmail={adminSession?.email ?? null} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Sign in with an email/password account. Admin access is granted per
            user in the `admin_users` table, while the worker admin token
            remains server-side only.
          </p>
          <AdminLoginForm />
        </>
      )}
    </main>
  );
}
