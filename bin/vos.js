#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeModuleUrl = new URL("../vos/packages/vos-bin/index.mjs", import.meta.url);
let runVosBinary;

try {
  ({ runVosBinary } = await import(runtimeModuleUrl.href));
} catch (error) {
  const code = error instanceof Error ? error.code : undefined;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
    console.error("vos: bundled runtime package is missing; reinstall the package.");
    process.exit(1);
  }
  throw error;
}

try {
  runVosBinary(process.argv.slice(2));
} catch (error) {
  console.error(`vos: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(0);
}
