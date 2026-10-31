import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentUser } from "./auth";

/** For server components: signed-in user, or a redirect to /setup (first run) or /login. */
export async function pageUser() {
  const user = await currentUser();
  if (user) return user;
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  redirect(n === 0 ? "/setup" : "/login");
}
