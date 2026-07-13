import { expect, test } from "@playwright/test";

test("desktop flight shell, controls, and mission drawer",async({page})=>{
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  await page.goto("/?simSpeed=4");
  await expect(page.locator("#scene")).toBeVisible();
  await expect(page.locator(".brand")).toContainText("SEA LEVEL");
  await expect(page.locator("#altitude")).not.toHaveText("--");
  await page.keyboard.press("KeyA");
  await expect(page.locator("#statusText")).toContainText("Autoland");
  await page.keyboard.press("KeyC"); await page.keyboard.press("KeyC"); await page.keyboard.press("KeyC");
  await expect(page.locator("#cameraButton span")).toHaveText("CHASE");
  await page.locator("#missionButton").click();
  await expect(page.locator("#missionDrawer")).not.toHaveClass(/hidden/);
  await expect(page.locator(".mission-card")).toHaveCount(4);
  await expect(page.locator(".mission-card").nth(1)).toBeDisabled();
  await page.screenshot({path:"test-results/desktop-flight.png",fullPage:true});
  expect(errors).toEqual([]);
});

test("mobile flight controls preserve the playfield",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await expect(page.locator(".touch-controls")).toBeVisible();
  await expect(page.locator(".command-dock")).toBeHidden();
  await expect(page.locator("[data-control=forward]")).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({path:"test-results/mobile-flight.png",fullPage:true});
});

test("assisted flight reaches touchdown and exposes replay",async({page})=>{
  test.setTimeout(30_000);
  await page.goto("/?simSpeed=4");
  await page.keyboard.press("KeyA");
  await expect(page.locator("#modalTitle")).toHaveText("TOUCHDOWN",{timeout:22_000});
  await expect(page.locator("#replayButton")).toBeEnabled();
  await page.locator("#modalReplay").click();
  await expect(page.locator("#replayTimeline")).not.toHaveClass(/hidden/);
  await page.screenshot({path:"test-results/touchdown-replay.png",fullPage:true});
});
