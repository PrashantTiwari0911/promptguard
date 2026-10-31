// Runs every labelled case and prints a per-category summary. Each case states the overall tier expected.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scan } from "../src/engine/scan";

interface Case { id: string; text: string; expect: "block" | "warn" | "allow" }
const cases: Case[] = readFileSync(new URL("./corpus/cases.jsonl", import.meta.url), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("labelled corpus", () => {
  for (const c of cases) {
    it(`${c.id} → ${c.expect}`, () => {
      const r = scan(c.text);
      const detail = r.findings.map((f) => `${f.tier}:${f.detector}:${JSON.stringify(c.text.slice(f.start, f.end).slice(0, 40))}`).join(" | ");
      expect(r.tier, detail).toBe(c.expect);
    });
  }
});
