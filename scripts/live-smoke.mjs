// Live smoke test against the real chatgpt.com (works logged out). Uses a synthetic TFN only.
// Usage: npm run build && node scripts/live-smoke.mjs [--headed]
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: !process.argv.includes("--headed"),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const page = await ctx.newPage();
const chatPosts = [];
page.on("request", (r) => { if (r.method() === "POST" && /conversation/.test(r.url())) chatPosts.push(r.url()); });
const out = {};
try {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  const ed = page.locator("#prompt-textarea, div.ProseMirror[contenteditable=true]").first();
  await ed.waitFor({ timeout: 30000 });
  out.composerFound = true;
  await ed.click();
  await page.keyboard.insertText("PromptGuard live test with a synthetic number. My TFN is 123 456 782.");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  out.panel = await page.evaluate(() => document.querySelector("#promptguard-panel")?.shadowRoot?.textContent ?? "");
  out.conversationPostsAfterBlockedEnter = chatPosts.length;
  const send = page.locator("#composer-submit-button, button[data-testid=send-button]").first();
  if (await send.count()) { await send.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1000); }
  out.conversationPostsAfterBlockedClick = chatPosts.length;
  out.stillInComposer = (await ed.innerText()).includes("123 456 782");
} catch (e) {
  out.error = String(e).slice(0, 300);
  out.title = await page.title().catch(() => "");
}
console.log(JSON.stringify(out, null, 2));
await ctx.close();
