import postgres, { type Sql } from "postgres";

let database: Sql | undefined;
export function db(): Sql {
  if (database) return database;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for production Portal commands");
  database = postgres(url, { max: Number(process.env.VOS_PORTAL_DB_POOL_SIZE ?? 10), idle_timeout: 20, connect_timeout: 10, prepare: false });
  return database;
}
export async function closeDatabase(): Promise<void> { if (database) await database.end({ timeout: 5 }); database = undefined; }
