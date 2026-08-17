import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { CourseManifestV1Schema } from "vos-core/portal-contracts";

test("xv6 course manifest binds the completed Lab 1-10 history and physical review boundary",async()=>{const root=path.resolve(import.meta.dirname,"../../../..");const source=path.join(root,"examples/xv6-spec");const manifest=CourseManifestV1Schema.parse(parse(await readFile(path.join(root,"courses/xv6-spec/course.yaml"),"utf8")));const expected=Array.from({length:10},(_,index)=>`course/lab${index+1}-complete`);expect(manifest.stages.map(stage=>stage.source_ref)).toEqual(expected);for(const tag of expected){const result=Bun.spawnSync(["git","rev-parse","--verify",`refs/tags/${tag}^{commit}`],{cwd:source,stdout:"pipe",stderr:"pipe"});expect(result.exitCode,`${tag}: ${result.stderr.toString()}`).toBe(0);}for(const stage of manifest.stages.slice(8)){expect(stage).toMatchObject({hardware_gate:"visionfive2-four-hart",human_review_required:true,manual_review_required:true});expect(stage.test_sets).toContain("usertests.four-hart");}});
