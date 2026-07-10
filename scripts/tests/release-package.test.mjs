import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootPackage = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const binPackage = JSON.parse(await readFile(new URL("../../vos/packages/vos-bin/package.json", import.meta.url), "utf8"));

test("public packages have aligned versions and no workspace dependencies", () => {
  assert.equal(rootPackage.name, "vos");
  assert.equal(binPackage.name, "vos-bin");
  assert.equal(rootPackage.version, binPackage.version);
  assert.equal(rootPackage.dependencies?.["vos-bin"], binPackage.version);
  assert.deepEqual(Object.keys(rootPackage.dependencies ?? {}), ["vos-bin"]);
  assert.equal(rootPackage.bin.vos, "./bin/vos.js");
  assert.ok(rootPackage.files.includes("bin/"));
  assert.ok(binPackage.files.includes("scripts/"));
  assert.ok(binPackage.exports["."]);
  assert.equal(binPackage.scripts.postinstall, "node ./scripts/install.mjs");
});

if (process.argv[2]) {
  test("release tag matches package versions", () => {
    assert.match(process.argv[2], /^v\d+\.\d+\.\d+$/);
    assert.equal(process.argv[2].slice(1), rootPackage.version);
  });
}
