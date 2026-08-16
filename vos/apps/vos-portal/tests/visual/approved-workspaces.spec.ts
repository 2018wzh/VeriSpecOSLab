import { expect, test } from "@playwright/test";
import path from "node:path";

const base=process.env.PORTAL_VISUAL_URL??"http://127.0.0.1:4173";
const output=process.env.PORTAL_VISUAL_OUTPUT??path.resolve(import.meta.dirname,"../../../../..",".tmp","portal-visual-actual");

for(const viewport of [{name:"desktop",width:1440,height:1024},{name:"laptop",width:1366,height:768},{name:"tablet",width:834,height:1112},{name:"mobile",width:390,height:844}]){
  test(`approved student workspace ${viewport.name}`,async({page})=>{await page.setViewportSize(viewport);await page.goto(base);await expect(page.getByRole("heading",{name:/学习工作台|Learning workspace/})).toBeVisible();await expect(page.getByRole("heading",{name:/继续完成|Continue/})).toBeVisible();await expect(page.getByRole("navigation",{name:/Lab 进度|Lab progress/})).toBeVisible();await page.screenshot({path:path.join(output,`student-${viewport.name}.png`),fullPage:true});});
}

test("approved teacher workspace desktop",async({page})=>{await page.setViewportSize({width:1440,height:1024});await page.goto(base);await page.getByRole("button",{name:/退出|Sign out/}).click();await page.getByRole("textbox",{name:/账号|Username/}).fill("teacher");await page.getByRole("textbox",{name:/密码|Password/}).fill("teacher");await page.getByRole("button",{name:/登录|Sign in/}).click();await expect(page.getByRole("heading",{name:/课程运营|Course operations/})).toBeVisible();await expect(page.getByRole("region",{name:/项目筛选|Project filters/})).toBeVisible();await expect(page.getByRole("heading",{name:/^项目$|^Project$/})).toBeVisible();await page.screenshot({path:path.join(output,"teacher-desktop.png"),fullPage:true});});
