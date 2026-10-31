// End-to-end tests: the built extension loaded into Chromium, against fixture pages served at the real
// site URLs (so the manifest's host matches apply). Network calls to the chat endpoints are recorded.
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../../dist");
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

let ctx: BrowserContext;
const requests: Array<{ url: string; body: string }> = [];

test.beforeAll(async () => {
  ctx = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const serve = (host: string, file: string) =>
    ctx.route(`https://${host}/**`, async (route) => {
      const url = route.request().url();
      if (url.includes("/__fixtures/app.js")) return route.fulfill({ contentType: "text/javascript", body: fixture("app.js") });
      if (route.request().method() === "POST") {
        requests.push({ url, body: route.request().postData() ?? "" });
        return route.fulfill({ contentType: "application/json", body: "{}" });
      }
      return route.fulfill({ contentType: "text/html", body: fixture(file) });
    });
  await serve("claude.ai", "claude.html");
  await serve("chatgpt.com", "chatgpt.html");
  await serve("gemini.google.com", "gemini.html");
});
test.afterAll(async () => ctx?.close());
test.beforeEach(() => { requests.length = 0; });

async function open(url: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => Array.isArray((window as any).__sent));
  return page;
}
const panelText = (page: Page) =>
  page.evaluate(() => document.querySelector("#promptguard-panel")?.shadowRoot?.textContent ?? "");
const sentCount = (page: Page) => page.evaluate(() => (window as any).__sent.length as number);
async function typeInto(page: Page, selector: string, text: string) {
  await page.click(selector);
  await page.keyboard.insertText(text);
}
async function paste(page: Page, selector: string, text: string) {
  await page.evaluate(([sel, t]) => {
    const el = document.querySelector(sel) as HTMLElement;
    el.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [selector, text] as const);
}
const panelButton = (page: Page, name: RegExp) => page.locator("#promptguard-panel").getByRole("button", { name });

const CLAUDE = '[data-testid="chat-input"]';
const GPT = "#prompt-textarea";
const AWS = "AKIAZ7Q2X4M9K3L5P8RT";

test.describe("claude.ai", () => {
  test("clean prompt sends on Enter with no panel", async () => {
    const page = await open("https://claude.ai/new");
    await typeInto(page, CLAUDE, "Can you summarise the RBA's latest rate decision?");
    await page.keyboard.press("Enter");
    await expect.poll(() => sentCount(page)).toBe(1);
    expect(await panelText(page)).toBe("");
    expect(requests).toHaveLength(1);
  });

  test("benign look-alikes send", async () => {
    const page = await open("https://claude.ai/new");
    await typeInto(page, CLAUDE, "Test card 4242 4242 4242 4242. interface User { password: string } AWS docs key AKIAIOSFODNN7EXAMPLE");
    await page.keyboard.press("Enter");
    await expect.poll(() => sentCount(page)).toBe(1);
  });

  test("TFN is blocked on Enter and on the button, every time", async () => {
    const page = await open("https://claude.ai/new");
    await typeInto(page, CLAUDE, "Please fill the form. My TFN is 123 456 782.");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Enter");
    await page.click('[data-testid="chat-input-send"]');
    await page.waitForTimeout(300);
    expect(await sentCount(page)).toBe(0);
    expect(requests).toHaveLength(0);
    const text = await panelText(page);
    expect(text).toContain("Not sent: 1 high-risk item found");
    expect(text).toContain("Tax file number");
    expect(text).toContain("••• ••• •82");
    expect(text).not.toContain("123 456 782");
  });

  test("Shift+Enter is not intercepted", async () => {
    const page = await open("https://claude.ai/new");
    await typeInto(page, CLAUDE, "TFN 123 456 782");
    await page.keyboard.press("Shift+Enter");
    expect(await panelText(page)).toBe("");
  });

  test("Redact fixes the prompt, which then sends", async () => {
    const page = await open("https://claude.ai/new");
    await typeInto(page, CLAUDE, "Card 4539 1488 0343 6467 and TFN 123 456 782, please check the form.");
    await page.keyboard.press("Enter");
    await panelButton(page, /Redact in message/).click();
    await expect.poll(() => page.locator(CLAUDE).innerText()).toContain("[CARD]");
    expect(await page.locator(CLAUDE).innerText()).toContain("[TFN]");
    await expect.poll(() => panelText(page)).toContain("Fixed");
    await page.click(CLAUDE);
    await page.keyboard.press("Enter");
    await expect.poll(() => sentCount(page)).toBe(1);
    expect(requests[0].body).not.toContain("4539");
  });

  test("large paste becomes a chip, is checked, and removing it lifts the block", async () => {
    const page = await open("https://claude.ai/new");
    const big = "Deployment notes for the billing service. ".repeat(150) + `\naws_access_key_id = ${AWS}\n` + "More notes. ".repeat(100);
    await paste(page, CLAUDE, big);
    await expect(page.locator('[data-testid="file-thumbnail"]')).toHaveCount(1);
    await typeInto(page, CLAUDE, "Summarise this");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    expect(await sentCount(page)).toBe(0);
    expect(await panelText(page)).toContain("AWS access key");
    await panelButton(page, /Remove pasted text 1/).click();
    await expect(page.locator('[data-testid="file-thumbnail"]')).toHaveCount(0);
    await expect.poll(() => panelText(page)).toContain("Fixed");
    await page.click(CLAUDE);
    await page.keyboard.press("Enter");
    await expect.poll(() => sentCount(page)).toBe(1);
  });

  test("a clean chip sends", async () => {
    const page = await open("https://claude.ai/new");
    await paste(page, CLAUDE, "Meeting notes about the roadmap and hiring plan. ".repeat(120));
    await expect(page.locator('[data-testid="file-thumbnail"]')).toHaveCount(1);
    await page.click('[data-testid="chat-input-send"]');
    await expect.poll(() => sentCount(page)).toBe(1);
  });

  test("network backstop stops a send path the UI listeners never saw", async () => {
    const page = await open("https://claude.ai/new");
    await page.evaluate(() => (window as any).__bypassSend("deploy with postgres://app:S3cr3t!pw@db.internal:5432/prod"));
    await expect.poll(() => page.evaluate(() => (window as any).__errors.length)).toBe(1);
    expect(requests).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).__errors[0])).toContain("PromptGuard stopped this request");
    expect(await panelText(page)).toContain("Database connection string");
  });

  test("the decision adds no visible delay to a clean send", async () => {
    const page = await open("https://claude.ai/new");
    await typeInto(page, CLAUDE, "Write a haiku about Melbourne trams. ".repeat(200));
    const ms = await page.evaluate(() => {
      const ed = document.querySelector('[data-testid="chat-input"]')!;
      const t0 = performance.now();
      ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return performance.now() - t0;
    });
    await expect.poll(() => sentCount(page)).toBe(1);
    expect(ms).toBeLessThan(50);
  });
});

test.describe("chatgpt.com", () => {
  test("form submit with a key in a code block is blocked", async () => {
    const page = await open("https://chatgpt.com/");
    await typeInto(page, GPT, "```python\nclient = OpenAI(api_key=\"sk-proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0" + "\")\n```\nwhy does this fail?");
    await page.keyboard.press("Enter");
    await page.click("#composer-submit-button");
    await page.waitForTimeout(200);
    expect(await sentCount(page)).toBe(0);
    expect(await panelText(page)).toContain("OpenAI API key");
  });

  test("chip over 9,000 characters with a password is blocked until removed", async () => {
    const page = await open("https://chatgpt.com/");
    const big = "Server inventory and notes. ".repeat(400) + "\nlogin is ops@acme.io / Tr0ub4dor&3x\n";
    await paste(page, GPT, big);
    await page.click("#composer-submit-button");
    await page.waitForTimeout(200);
    expect(await sentCount(page)).toBe(0);
    expect(await panelText(page)).toContain("Password");
    await panelButton(page, /Remove pasted text 1/).click();
    await expect.poll(() => panelText(page)).toContain("Fixed");
  });

  test("warn tier: an order number can be sent after giving a reason", async () => {
    const page = await open("https://chatgpt.com/");
    await typeInto(page, GPT, "My order #123456782 has not arrived, draft a complaint.");
    await page.keyboard.press("Enter");
    expect(await panelText(page)).toContain("Check before sending");
    await panelButton(page, /Send anyway/).click();
    await page.locator("#promptguard-panel").getByRole("textbox").fill("It is an order number, not a TFN");
    await panelButton(page, /^Send$/).click();
    await expect.poll(() => sentCount(page)).toBe(1);
  });
});

test.describe("gemini.google.com", () => {
  test("Aadhaar is blocked, clean prompt sends", async () => {
    const page = await open("https://gemini.google.com/app");
    const ed = "rich-textarea .ql-editor";
    await typeInto(page, ed, "Aadhaar: 3674 1950 2866, update my KYC");
    await page.click('button[aria-label="Send message"]');
    await page.waitForTimeout(200);
    expect(await sentCount(page)).toBe(0);
    expect(await panelText(page)).toContain("Aadhaar number");
    await page.evaluate((sel) => { (document.querySelector(sel) as HTMLElement).innerHTML = "<p><br></p>"; }, ed);
    await typeInto(page, ed, "Explain how KYC works in India");
    await page.click('button[aria-label="Send message"]');
    await expect.poll(() => sentCount(page)).toBe(1);
  });

  test("backstop reads Gemini's form-encoded body", async () => {
    const page = await open("https://gemini.google.com/app");
    await page.evaluate(() => (window as any).__bypassSend("My SSN is 123-45-6789"));
    await expect.poll(() => page.evaluate(() => (window as any).__errors.length)).toBe(1);
    expect(requests).toHaveLength(0);
  });
});
