import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n > 0) redirect("/login");
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <AuthForm mode="setup" />
    </div>
  );
}
