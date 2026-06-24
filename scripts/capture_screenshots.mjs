// Capture documentation screenshots of the running app with headless Chrome.
//
// Prereqs: the dev server (npm run dev, :1420) and the engine sidecar (:8765)
// must both be up, with the Example scenario loaded in the workspace. Uses the
// system Chrome via puppeteer-core (no bundled browser download).
//
//   node scripts/capture_screenshots.mjs
//
// Writes PNGs into docs/img/.

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH
  || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = "http://localhost:1420";
const OUT = path.resolve("docs/img");
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

const TABS = [
  { label: "Freedom", file: "freedom.png" },
  { label: "Cash Flow", file: "cashflow.png" },
  { label: "Accounts", file: "accounts.png" },
  { label: "Taxes", file: "taxes.png" },
  { label: "Assumptions", file: "assumptions.png" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickNav(page, label) {
  const ok = await page.evaluate((text) => {
    const b = [...document.querySelectorAll("button.navitem")]
      .find((x) => x.textContent.trim() === text);
    if (b) { b.click(); return true; }
    return false;
  }, label);
  if (!ok) throw new Error(`nav button not found: ${label}`);
}

// Trigger every on-demand analysis on the current tab (the "Recompute" panels:
// sensitivity, success surface, …) so the showcase shows results, not buttons.
async function triggerRecomputes(page) {
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if (b.textContent.trim() === "Recompute") b.click();
    }
  });
}

// Wait until no chart is mid-flight (the app renders a "Computing…" placeholder
// while an async analysis runs).
async function waitSettled(page, timeout = 25000) {
  await page.waitForFunction(
    () => !/Computing|Loading/i.test(document.body.innerText),
    { timeout, polling: 500 },
  ).catch(() => {});
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--force-color-profile=srgb"],
    defaultViewport: VIEWPORT,
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Wait for the app shell and the first charts to render (sim + sweep land a
  // beat after mount via the debounced simulate).
  await page.waitForSelector("button.navitem", { timeout: 30000 });
  await page.waitForSelector(".js-plotly-plot", { timeout: 30000 });
  await sleep(2500);

  // Hero: the Freedom tab at viewport height (headline tiles + retire sweep).
  await clickNav(page, "Freedom");
  await triggerRecomputes(page);
  await waitSettled(page);
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, "hero.png") });
  console.log("captured hero.png");

  for (const { label, file } of TABS) {
    await clickNav(page, label);
    await page.waitForSelector(".js-plotly-plot", { timeout: 30000 }).catch(() => {});
    await triggerRecomputes(page);
    await waitSettled(page);
    await sleep(2000);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
    console.log(`captured ${file}`);
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
