import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const SHOT = process.env.SHOT_DIR ?? "C:\\Users\\divya\\AppData\\Local\\Temp\\opencode\\shots";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[console.error]", msg.text());
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto(BASE);
  await page.waitForURL("**/login");
  await page.screenshot({ path: `${SHOT}\\01-login.png` });
  console.log("login page OK");

  await page.getByRole("button", { name: /Use demo account/ }).click();
  await page.waitForURL("**/dashboard");
  await page.waitForSelector("text=Compose New Email");
  await delay(800);
  await page.screenshot({ path: `${SHOT}\\02-dashboard.png` });
  const headerText = await page.locator("header").innerText();
  console.log("dashboard OK, header contains demo:", headerText.includes("Demo User"));

  await page.getByRole("button", { name: /Compose New Email/ }).click();
  await page.waitForSelector("text=Compose new email");
  await page.getByLabel("Subject").fill("E2E campaign from Playwright");
  await page.getByLabel("Body").fill("<p>Hello! This was scheduled end-to-end.</p>");

  const emails = Array.from({ length: 6 }, (_, i) => `e2e-user${i}@playwright.io`).join("\n");
  await page.locator('input[type="file"]').setInputFiles({
    name: "leads.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`email,\n${emails}`, "utf8"),
  });
  await page.waitForSelector("text=6 emails detected");
  console.log("CSV parsing OK: 6 emails detected");

  const startAt = new Date(Date.now() + 20_000);
  const pad = (n) => String(n).padStart(2, "0");
  const local = `${startAt.getFullYear()}-${pad(startAt.getMonth() + 1)}-${pad(startAt.getDate())}T${pad(startAt.getHours())}:${pad(startAt.getMinutes())}`;
  await page.getByLabel("Start time").fill(local);
  await page.screenshot({ path: `${SHOT}\\03-compose.png` });

  await page.getByRole("button", { name: /Schedule 6 emails/ }).click();
  await page.waitForSelector("text=Scheduled 6 emails");
  console.log("scheduled via UI OK");

  await delay(1500);
  await page.screenshot({ path: `${SHOT}\\04-scheduled.png` });
  const schedRows = await page.locator("table tbody tr").count();
  console.log("scheduled table rows:", schedRows);

  await page.getByPlaceholder("Search sent & scheduled").fill("playwright.io");
  await delay(1200);
  await page.screenshot({ path: `${SHOT}\\05-search.png` });
  console.log("search executed");

  await delay(35_000);
  // Clear the search so the table under test is the tab's own table.
  await page.getByPlaceholder("Search sent & scheduled").fill("");
  await delay(600);
  await page.getByRole("button", { name: /Sent Emails/ }).click();
  await delay(2500);
  await page.screenshot({ path: `${SHOT}\\06-sent.png` });
  const sentText = await page.locator("table").first().innerText();
  const sentCount = await page.locator("table tbody tr").count();
  console.log("sent table rows:", sentCount, "| has Sent badge:", sentText.includes("Sent"));

  await page.reload();
  await delay(3000);
  await page.screenshot({ path: `${SHOT}\\07-reload.png` });
  console.log("reload OK");

  await browser.close();
  console.log("E2E COMPLETE");
}

main().catch((err) => {
  console.error("E2E FAILED", err);
  process.exit(1);
});