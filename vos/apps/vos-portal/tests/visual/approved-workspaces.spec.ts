import { expect, test } from "@playwright/test";
import path from "node:path";

const base=process.env.PORTAL_VISUAL_URL??"http://127.0.0.1:4173";
const output=process.env.PORTAL_VISUAL_OUTPUT??path.resolve(import.meta.dirname,"../../../../..",".tmp","portal-visual-actual");

for(const viewport of [{name:"desktop",width:1440,height:1024},{name:"laptop",width:1366,height:768},{name:"tablet",width:834,height:1112},{name:"mobile",width:390,height:844}]){
  test(`approved student workspace ${viewport.name}`,async({page})=>{await page.setViewportSize(viewport);await page.goto(base);await expect(page.getByRole("heading",{name:"操作系统课程实验"})).toBeVisible();await expect(page.getByRole("heading",{name:/继续完成/})).toBeVisible();await expect(page.getByRole("navigation",{name:"Lab 进度"})).toBeVisible();await page.screenshot({path:path.join(output,`student-${viewport.name}.png`),fullPage:true});});
}

test("approved teacher workspace desktop",async({page})=>{await page.setViewportSize({width:1440,height:1024});await page.goto(base);await page.getByRole("combobox",{name:/演示角色|Demo role/}).selectOption("teacher");await expect(page.getByRole("heading",{name:/课程运营|Course operations/})).toBeVisible();await expect(page.getByRole("region",{name:/项目筛选|Project filters/})).toBeVisible();await expect(page.getByRole("heading",{name:/^项目$|^Project$/})).toBeVisible();await page.screenshot({path:path.join(output,"teacher-desktop.png"),fullPage:true});});
