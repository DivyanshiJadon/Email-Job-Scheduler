import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://localhost:5173";
const SHOT = process.env.SHOT_DIR ?? "C:\\Users\\divya\\AppData\\Local\\Temp\\opencode\\shots";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// The real login is Google OAuth (interactive). For automation we mint a
// dev JWT with the same secret the API validates against, then seed it
// into localStorage before the app loads — identical to a successful callback.
async function seedToken(page) {
  const { default: jwt } = await import("../../backend/node_modules/jsonwebtoken/index.js");
  const envPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../backend/.env.local"
  );
  const secret = (readFileSync(envPath, "utf8").match(/^JWT_SECRET=(.+)$/m) ?? [])[1];
  if (!secret) throw new Error("JWT_SECRET not found in backend/.env.local");
  const token = jwt.sign(
    { sub: "e2e-user", email: "e2e@test.local", name: "E2E User", avatar: null },
    secret.trim(),
    { expiresIn: "1h" }
  );
  await page.context().addInitScript((tok) => {
    localStorage.setItem("reachinbox_token", tok);
  }, token);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[console.error]", msg.text());
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await seedToken(page);
  await page.goto(BASE);
  await page.waitForURL("**/dashboard");
  await page.waitForSelector("text=Compose New Email");
  await page.screenshot({ path: `${SHOT}\\01-dashboard.png` });
  const headerText = await page.locator("header").innerText();
  console.log("dashboard OK, header contains E2E user:", headerText.includes("E2E User"));

  await page.getByRole("button", { name: /Compose New Email/ }).first().click();
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

  // Wait (up to 2 min) until the batch is actually delivered — deterministic
  // regardless of scheduledAt offset + min-delay spacing.
  await page.waitForFunction(
    async () => {
      const res = await fetch("/api/emails/sent?size=50", {
        headers: { Authorization: `Bearer ${localStorage.getItem("reachinbox_token")}` },
      });
      if (!res.ok) return false;
      const json = await res.json();
      return (json.data ?? []).some((e) => e.recipient.includes("playwright.io"));
    },
    { timeout: 120_000 }
  );
  console.log("delivery confirmed via API");

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