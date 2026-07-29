import { closeDatabase, db } from "../storage/database.ts";
import { migrate } from "../storage/migrate.ts";
import { runWorker } from "../worker/worker.ts";
import { startPortalServer } from "./http.ts";
import { seed } from "./seed.ts";
import { collectExpiredObjects } from "../storage/gc.ts";
import { S3ObjectStore } from "../storage/s3.ts";

const command=process.argv[2];
if(command==="serve"){const server=await startPortalServer();console.log(`vos-portal listening on ${server.url}`);}
else if(command==="migrate"){await migrate();await closeDatabase();}
else if(command==="seed"){await migrate();await seed();await closeDatabase();}
else if(command==="gc"){const result=await collectExpiredObjects(db(),S3ObjectStore.fromEnv());console.log(`deleted ${result.deleted} expired objects; ${result.failed} failed`);if(result.failed)process.exitCode=1;await closeDatabase();}
else if(command==="worker"){const controller=new AbortController();process.on("SIGINT",()=>controller.abort());process.on("SIGTERM",()=>controller.abort());await runWorker(controller.signal);await closeDatabase();}
else throw new Error("usage: vos-portal <serve|worker|migrate|seed|gc>");
