import { expect, test } from "@playwright/test";

test("desktop flight shell, controls, and mission drawer",async({page})=>{
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  await page.goto("/?simSpeed=4");
  await expect(page.locator("#scene")).toBeVisible();
  await expect(page.locator(".brand")).toContainText("SEA LEVEL");
  await expect(page.locator("#altitude")).not.toHaveText("--");
  await expect(page.locator("#modal")).toHaveAttribute("aria-labelledby","modalTitle");
  await expect(page.locator("#throttle")).toHaveAttribute("aria-label","Engine throttle");
  await page.keyboard.press("KeyA");
  await expect(page.locator("#statusText")).toContainText("Autoland");
  await page.keyboard.press("KeyC"); await page.keyboard.press("KeyC"); await page.keyboard.press("KeyC"); await page.keyboard.press("KeyC"); await page.keyboard.press("KeyC");
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
  await expect(page.locator("#flightMenuButton")).toBeVisible();
  await expect(page.locator("#drift")).toBeVisible();
  await expect(page.locator("#touchThrottle")).toBeVisible();
  await expect(page.locator("[data-control=forward]")).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({path:"test-results/mobile-flight.png",fullPage:true});
});

test("assisted flight reaches touchdown and exposes replay",async({page})=>{
  test.setTimeout(60_000);
  await page.goto("/?simSpeed=6");
  await expect(page.locator("#altitude")).not.toHaveText("--");
  await page.keyboard.press("KeyA");
  await expect(page.locator("#statusText")).toContainText("Autoland");
  await expect(page.locator("#modalTitle")).toHaveText("TOUCHDOWN",{timeout:45_000});
  await expect(page.locator("#replayButton")).toBeEnabled();
  await expect(page.locator("#landingDebrief")).toBeVisible();
  await page.locator("#landingDebrief summary").click();
  await expect(page.locator("#landingDebrief tbody tr")).toHaveCount(8);
  await expect(page.locator("#landingDebrief tr[data-passed=false]")).toHaveCount(0);
  await page.screenshot({path:"test-results/touchdown-debrief.png",fullPage:true});
  await page.locator("#modalReplay").click();
  await expect(page.locator("#replayTimeline")).not.toHaveClass(/hidden/);
  await page.screenshot({path:"test-results/touchdown-replay.png",fullPage:true});
});


test("touch-only flight menu supports missions, camera, assist, pause and reset", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("#altitude")).not.toHaveText("--");
  const open = async () => { await page.locator("#flightMenuButton").tap(); await expect(page.locator("#flightActions")).toHaveClass(/menu-open/); };
  await open();
  await expect(page.locator("#pauseButton span")).toHaveText("PAUSE");
  const altitude = await page.locator("#altitude").textContent();
  await page.waitForTimeout(250);
  await expect(page.locator("#altitude")).toHaveText(altitude!);
  await page.locator("#missionButton").tap();
  await expect(page.locator("#missionDrawer")).toBeVisible();
  await page.locator(".mission-card").first().tap();
  await expect(page.locator("#missionDrawer")).toBeHidden();
  await open(); await page.locator("#cameraButton").tap();
  await expect(page.locator("#cameraButton span")).toHaveText("DECK");
  await open(); await page.locator("#autoButton").tap();
  await expect(page.locator("#statusText")).toContainText("Autoland");
  await open(); await page.locator("#pauseButton").tap();
  await expect(page.locator("#modalTitle")).toHaveText("FLIGHT PAUSED");
  await expect(page.locator("#landingDebrief")).toBeHidden();
  await page.locator("#modalAction").tap();
  await expect(page.locator("#modal")).toBeHidden();
  await open(); await page.locator("#restartButton").tap();
  await expect(page.locator("#autoButton")).toHaveAttribute("aria-pressed", "false");
  await open();
  await page.screenshot({ path: "test-results/mobile-menu.png", fullPage: true });
  await page.locator("#closeFlightMenu").tap();
  await expect(page.locator("#flightMenuButton")).toBeFocused();
  await context.close();
});

test("blocking panels isolate keyboard input and clear held controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#altitude")).not.toHaveText("--");
  await page.keyboard.down("KeyW");
  await page.keyboard.press("KeyM");
  await expect(page.locator("#missionDrawer")).toBeVisible();
  const throttle = await page.locator("#throttleValue").textContent();
  const camera = await page.locator("#cameraButton span").textContent();
  await page.keyboard.press("KeyC");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("KeyA");
  await page.waitForTimeout(200);
  await expect(page.locator("#throttleValue")).toHaveText(throttle!);
  await expect(page.locator("#cameraButton span")).toHaveText(camera!);
  await page.keyboard.press("Escape");
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(200);
  await expect(page.locator("#throttleValue")).toHaveText(throttle!);
  await expect(page.locator("#missionDrawer")).toBeHidden();
});


test("failed contact explains the cause and supports touch replay and retry", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto("/?simSpeed=6");
  await expect(page.locator("#altitude")).not.toHaveText("--");
  const throttleDown = await page.locator("[data-control=throttleDown]").boundingBox();
  const touch = await context.newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: throttleDown!.x + throttleDown!.width / 2, y: throttleDown!.y + throttleDown!.height / 2 }] });
  await expect(page.locator("#touchThrottle")).toHaveText("0%", { timeout: 10_000 });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator("#modalTitle")).toHaveText("VEHICLE LOST", { timeout: 25_000 });
  await expect(page.locator("#landingDebrief .next-attempt")).toContainText("Next attempt:");
  await expect(page.locator("#modalCopy")).not.toContainText("Peak tilt");
  await page.locator("#landingDebrief summary").tap();
  expect(await page.locator("#landingDebrief tr[data-passed=false]").count()).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/mobile-debrief.png", fullPage: true });
  await page.locator("#modalReplay").tap();
  await expect(page.locator("#replayTimeline")).not.toHaveClass(/hidden/);
  await page.locator("#flightMenuButton").tap();
  await page.locator("#replayButton").tap();
  await expect(page.locator("#replayTimeline")).toHaveClass(/hidden/);
  await expect(page.locator("#modal")).toBeHidden();
  await context.close();
});

test("flight menu remains reachable on narrow and short screens", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect(page.locator("#altitude")).not.toHaveText("--");
  await page.locator("#flightMenuButton").click();
  for (const viewport of [{ width: 320, height: 740 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#closeFlightMenu")).toBeVisible();
    await expect(page.locator("#restartButton")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/menu-${viewport.width}.png`, fullPage: true });
  }
  await page.locator("#closeFlightMenu").click();
  await expect(page.locator("#flightMenuButton")).toHaveAttribute("aria-expanded", "false");
});
