import Link from "next/link";
import { inArray, count } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { pageUser } from "@/lib/page-auth";
import { isDemo } from "@/lib/env";
import { extractionMode } from "@/extraction/extract";
import { NavLinks } from "@/components/NavLinks";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await pageUser();
  const db = await getDb();
  const [{ n: reviewCount }] = await db
    .select({ n: count() })
    .from(schema.documents)
    .where(inArray(schema.documents.status, ["needs_review", "duplicate"]));
  const mode = extractionMode();

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col">
      {(isDemo() || mode !== "claude") && (
        <div className="bg-amber-500/15 px-4 py-1.5 text-center text-xs font-medium text-amber-700 dark:text-amber-300">
          {mode === "claude" ? "Demo mode" : "Demo mode: no ANTHROPIC_API_KEY, so extraction returns sample data."}
        </div>
      )}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b line bg-[var(--bg)]/90 px-4 py-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">RV</span>
          <span>ReceiptVault</span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm md:flex">
          <NavLinks reviewCount={reviewCount} variant="top" />
        </nav>
        <span className="hidden text-xs muted sm:inline">
          {user.email} · {user.role}
        </span>
      </header>
      <main className="flex-1 px-4 pb-28 pt-4 md:pb-10">{children}</main>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t line bg-[var(--card)]/95 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          <NavLinks reviewCount={reviewCount} variant="bottom" />
        </div>
      </nav>
    </div>
  );
}
