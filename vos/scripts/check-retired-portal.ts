import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root=path.resolve(import.meta.dir,"..","..");
const retired=["vos"+"-web","dev:"+"web"];
const ignored=new Set([".git",".tmp",".worktrees","node_modules","dist","dist-demo"]);
const violations:string[]=[];

async function visit(directory:string):Promise<void>{
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(ignored.has(entry.name))continue;
    const full=path.join(directory,entry.name);
    if(entry.isDirectory()){await visit(full);continue;}
    if(full===import.meta.path)continue;
    const content=await readFile(full,"utf8").catch(()=>"");
    if(retired.some((value)=>content.includes(value)))violations.push(path.relative(root,full));
  }
}

await visit(root);
if(violations.length)throw new Error(`retired Portal references found:\n${violations.join("\n")}`);
console.log("retired Portal reference gate passed");
