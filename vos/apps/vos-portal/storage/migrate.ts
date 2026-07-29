import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./database.ts";

export async function migrate(): Promise<void> {
  const sql = db(); const root = path.join(import.meta.dir, "migrations");
  await sql`create table if not exists schema_migrations (version bigint primary key, applied_at timestamptz not null default now())`;
  const files = (await readdir(root)).filter((name) => /^\d+_.+\.sql$/.test(name)).toSorted();
  for (const file of files) {
    const version = Number(file.split("_", 1)[0]); const applied = await sql`select 1 from schema_migrations where version = ${version}`;
    if (applied.length) continue;
    const source = await readFile(path.join(root, file), "utf8");
    await sql.begin(async (tx) => { await tx.unsafe(source); await tx`insert into schema_migrations (version) values (${version})`; });
    console.log(`applied migration ${file}`);
  }
}
