import { getDb, dbKind } from "../src/db";

await getDb();
console.log(`Migrations applied (${dbKind()}).`);
process.exit(0);
