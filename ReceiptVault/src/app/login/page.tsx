import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentUser } from "@/lib/auth";
import { isDemo } from "@/lib/env";
import { AuthForm } from "@/components/AuthForm";
import { DEMO_USER } from "@/lib/demo";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n === 0) redirect("/setup");
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <AuthForm mode="login" demoHint={isDemo() ? DEMO_USER : undefined} />
    </div>
  );
}
