import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

describe("English translation coverage",()=>{
  test("covers every literal UI translation key",async()=>{
    const client=path.join(import.meta.dir,"..","client");
    const resources=ts.createSourceFile("i18n.ts",await readFile(path.join(client,"i18n.ts"),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    const english=new Set<string>();
    function collectEnglish(node:ts.Node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==="en"&&node.initializer){const value=ts.isAsExpression(node.initializer)?node.initializer.expression:node.initializer;if(ts.isObjectLiteralExpression(value)){for(const property of value.properties){if(ts.isPropertyAssignment(property)){const name=property.name;if(ts.isIdentifier(name)||ts.isStringLiteral(name)||ts.isNumericLiteral(name))english.add(name.text);}}}}ts.forEachChild(node,collectEnglish);}
    collectEnglish(resources);
    const used=new Map<string,string[]>();
    for(const file of await sourceFiles(client)){const source=ts.createSourceFile(file,await readFile(file,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);function visit(node:ts.Node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==="t"&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){const key=node.arguments[0].text;const locations=used.get(key)??[];locations.push(path.relative(client,file));used.set(key,locations);}ts.forEachChild(node,visit);}visit(source);}
    const missing=[...used].filter(([key])=>!english.has(key)).map(([key,files])=>`${JSON.stringify(key)} (${[...new Set(files)].join(", ")})`);
    expect(missing).toEqual([]);
  });
});

async function sourceFiles(root:string):Promise<string[]>{const output:string[]=[];for(const entry of await readdir(root,{withFileTypes:true})){const absolute=path.join(root,entry.name);if(entry.isDirectory())output.push(...await sourceFiles(absolute));else if(entry.name.endsWith(".tsx"))output.push(absolute);}return output;}
