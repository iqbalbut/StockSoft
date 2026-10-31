import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";
import { env } from "@/lib/env";

export type DB = NodePgDatabase<typeof schema>;

type Holder = { db?: DB; ready?: Promise<void>; kind?: "postgres" | "pglite" };
const g = globalThis as unknown as { __receiptVaultDb?: Holder };
const holder: Holder = (g.__receiptVaultDb ??= {});

const migrationsFolder = path.resolve(process.cwd(), "drizzle");

async function init(): Promise<void> {
  const url = env().DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 10 });
    const db = drizzlePg(pool, { schema });
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder });
    holder.db = db;
    holder.kind = "postgres";
  } else {
    // Zero-setup embedded Postgres (WASM) for demo mode and local development.
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dir = env().PGLITE_DIR;
    if (dir !== "memory://") fs.mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    holder.db = db as unknown as DB;
    holder.kind = "pglite";
  }
}

/** Returns the database, running pending migrations on first use. */
export async function getDb(): Promise<DB> {
  if (!holder.ready) holder.ready = init().catch((e) => {
    holder.ready = undefined;
    throw e;
  });
  await holder.ready;
  return holder.db!;
}

export const dbKind = () => holder.kind;
export { schema };
