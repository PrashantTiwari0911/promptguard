# PromptGuard

A Chrome extension that checks a prompt at the moment you press **Send** or **Enter** on claude.ai, chatgpt.com
and gemini.google.com, and stops it if it contains high-risk data. Clean prompts go through untouched: the check runs
synchronously inside the key or click event, on the device, in about 1 ms for a typical prompt.

Built for the Aionix take-home (Senior AI Software Engineer). Full design with diagrams: [`docs/design.html`](docs/design.html).

## Quick start (about 5 minutes)

```bash
npm ci
npm run build          # outputs dist/
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `dist/` folder.
2. Open claude.ai, chatgpt.com or gemini.google.com and type `My TFN is 123 456 782` (a synthetic, checksum-valid
   number), then press Enter. The message is not sent and a panel explains why. Click **Redact in message** and send.

Tests:

```bash
npm test               # unit tests + 87-case labelled corpus (Vitest)
npx playwright install chromium
npm run e2e            # 14 end-to-end tests with the extension loaded in Chromium
npm run bench          # latency per input size, adversarial-regex check, false-positive sweep over node_modules
```

## How it works

```
 Enter / Send click / form submit
        │  (capture phase on window: runs before the app's own handlers)
        ▼
 collect text: composer + full text behind every paste/file chip
        │
        ▼
 rules engine (sync, ~1 ms): normalise → candidates → checksums → context → suppressors → tier
        │
   allow ─┴──────────────► event untouched, app sends normally (no delay, no replay)
   warn  ───────────────► event stopped, panel: edit, or "Send anyway" with a reason
   block ───────────────► event stopped, panel: masked findings, reasons, Redact, Remove attachment

 Backstop: a fetch/XHR wrapper in the page's own world scans chat requests and rejects any with a
 block-tier finding, covering send paths the UI listeners never saw.
```

* **Why it is fast:** the decision is made inside the original event, so clean prompts are never held or re-sent.
  The engine is plain regex + checksum code: no model, no network.
* **Can't be bypassed by sending again:** there is no "blocked once" state; every attempt is re-checked, and the
  network backstop stops anything that slips past the UI.
* **Fixing the prompt:** the panel lists each item with a masked value (`••• ••• •82`) and the reason, offers
  **Redact in message** (replaces values with `[TFN]`, `[CARD]`… through the editor's own input path),
  **Show** (selects the value) and **Remove pasted text N**. It re-checks as you edit and says when it is clear.
* **Paste chips:** claude.ai (above ~4,000 characters) and ChatGPT (above ~9,000) turn big pastes into chips whose
  full text is **not** in the page. The extension keeps the text from the paste event (and from dropped or uploaded
  text files), matches it to the chip by its preview, and forgets it when the chip is removed, which lifts the block.

## What is detected

| # | Category | How | Default |
|---|---|---|---|
| 1 | API keys and access tokens | 16 provider formats (Anthropic, OpenAI, AWS, GitHub, GitLab, Slack, Google, Stripe, SendGrid, Hugging Face, npm…), JWTs (header decoded), bearer tokens | Block |
| 2 | Passwords, secrets, private keys | Labelled passwords in 20+ languages; secret assignments with entropy check; PEM/PuTTY private keys; unlabelled random-looking strings next to login details | Block (unlabelled without login context: Warn) |
| 3 | Government IDs | US SSN (valid ranges), passport (label or MRZ with ICAO check digits), driver licence and national IDs (label), Medicare (check digit + label) | Block |
| 4 | Australian TFN | 8/9 digits, mod-11 checksum (python-stdnum weights) + TFN label or 3-3-3 grouping; "Order #…" downgrades to Warn | Block |
| 5 | Cards and bank accounts | Luhn + real card prefix; published test cards allowed; IBAN mod-97; BSB + account with a banking label | Block |
| 6 | ABN/PAN next to a name, Aadhaar | ABN mod-89 beside a person's name (company ABNs are public); PAN beside a name (5th letter checked against the surname); Aadhaar Verhoeff + label or 4-4-4 grouping | Block |
| 7 | Database credentials | postgres/mysql/mongodb/redis/… URLs with a literal password, JDBC, ADO.NET, Azure storage strings, `PGPASSWORD=`-style variables | Block |
| 8 | Customer financial records | Same-record rule: a labelled customer + a name + financial fields with money amounts; CSV with name/email **and** balance/amount columns | Block |
| 9 | Medical records | Same-record rule: a patient identifier (Patient:, DOB, MRN, Medicare) + health details (diagnosis, medication + dose, ICD-10 code); CSV with name **and** diagnosis columns | Block |
| 10 | Trade secrets, proprietary code | Confidentiality markers (CONFIDENTIAL, Proprietary, Do not distribute…) and org fingerprints from policy; very large unmarked code pastes | Block (large unmarked code: Warn) |

Normalisation runs first and keeps every offset: digits from 20+ scripts (Devanagari, Arabic, full-width…) become
0–9, zero-width characters and unusual spaces become spaces, and dash variants become `-`. So values written with
spaces, dashes, other scripts, inside code blocks, JSON or CSV are all caught.

### Categories 8–10: the decision and why

A disease name or an account balance on its own is not personal information. The risk comes from the **link**
between a person and their data. So categories 8 and 9 block only when an identifier and the sensitive details
appear in the **same record** (paragraph, CSV row or table, JSON object). General questions ("symptoms of
diabetes?", "how is a credit score calculated?") and questions about public figures pass.

For category 10, content alone can't tell you who owns a piece of code, and asking AI about code is a core,
legitimate use. Blocking all code would push engineers to switch the guard off. So it blocks on explicit
confidentiality markers and on fingerprints the security team configures (internal hostnames, codenames,
package prefixes in `Policy`), and only warns on very large unmarked code pastes.

### Keeping false positives low

* Checksums are not enough on their own: a random number passes Luhn about 1 time in 10, the TFN check 1 in 11.
  Weak checksums also need a label, the expected grouping, or a CSV/JSON column name.
* Look-alikes are recognised and allowed: published test cards (4242…), `sk_test_` keys, the AWS documentation key,
  placeholders (`<password>`, `${DB_PASS}`, `****`), masked values, code references (`password: string`,
  `form['password']`), and company ABNs.
* Reference labels ("Order #", "Invoice", "Ref") **downgrade** a weak match to Warn. They never cancel a strong one.
* Three tiers: **Block** (no override), **Warn** (send after giving a reason), **Allow**.

## Results (1 Nov 2026, this repo)

| Check | Result |
|---|---|
| Unit + labelled corpus (87 cases incl. every edge case in the brief) | 100 / 100 pass |
| End-to-end, extension in Chromium, fixture pages copying each site's structure | 14 / 14 pass |
| Latency, typical prompt (1 KB / 10 KB) | p95 0.5 ms / 1.1 ms |
| Latency, 100 KB / 1 MB | p95 12 ms / 112 ms |
| Worst adversarial regex input | 20 ms |
| False positives: 566 benign source/docs files from `node_modules` | 0 blocked (0.0%); 64 warned, nearly all "large code paste" on whole files |
| Live check on the real claude.ai and chatgpt.com (logged in, Chrome) | Real Enter and real Send clicks stopped by the capture-phase guard, text kept; Redact's `insertText` path works on claude.ai's editor |

The end-to-end suite covers: clean send, look-alikes, TFN blocked five times in a row plus button click,
Shift+Enter ignored, Redact then send, chip blocked then removed, clean chip, network backstop, decision time on a
large clean prompt, ChatGPT form submit with a key in a code block, ChatGPT chip with a password, the Warn flow with a
reason, Gemini block and send, and Gemini's form-encoded request body in the backstop.

## Limits and what's next

* **Selectors drift.** Each site has one adapter (`src/content/adapters.ts`) with generic fallbacks, and the backstop
  covers send paths the listeners miss. The backstop endpoint patterns were written from the sites' known APIs and
  are tested on fixtures, not yet against live traffic.
* **ChatGPT may upload pasted text when the chip appears**, before Send. The send is still blocked, but the text may
  already have reached OpenAI's file store. A strict mode that cancels a dirty paste is the next step; this is worth
  discussing with the security team.
* Images, PDFs and screenshots are not scanned (OCR is the natural next step). Deliberate obfuscation such as base64
  or splitting a secret across messages is out of scope.
* An optional on-device model (MiniLM embeddings + calibrated classifier) would improve recall for categories 8–10
  on unstructured text. It is designed to run before Send with a 700 ms cap and can only escalate a decision
  (see the design doc, section 12). It is not built.
* Users can disable an extension. In an organisation, force-install it with the `ExtensionInstallForcelist` policy.

## Layout

```
src/engine/     normalise.ts, validators.ts, context.ts, detectors.ts, scan.ts, types.ts   (pure TS, no DOM)
src/content/    index.ts (interceptor), adapters.ts, chips.ts, panel.ts                    (isolated world)
src/backstop/   main-world.ts (fetch/XHR wrapper)                                          (page world)
test/           validators + corpus tests, corpus/cases.jsonl, e2e/ (Playwright + fixtures)
scripts/        bench.ts, gen-synthetic.ts (checksum-valid fake IDs), live-smoke.mjs
docs/           design.html
```

Every identifier in the tests is synthetic: generated to pass its checksum, or a published sample. None belongs to a
real person.
