// Entry point of the engine: normalise, run every detector, resolve overlaps, apply the policy.
import { DETECTORS } from "./detectors";
import { normalise } from "./normalise";
import { DEFAULT_POLICY, type Finding, type Policy, type ScanResult, type Tier } from "./types";

export function scan(text: string, policy: Policy = DEFAULT_POLICY): ScanResult {
  const n = normalise(text);
  const all: Finding[] = [];
  for (const detect of DETECTORS) all.push(...detect({ n, policy }));

  const allow = new Set(policy.allowValues.map((v) => v.replace(/\s/g, "")));
  for (const x of all) {
    if (x.tier !== "allow" && allow.has(n.slice(x.start, x.end).replace(/\s/g, ""))) {
      x.tier = "allow";
      x.why = "On your organisation's allow list";
    }
  }

  // Higher-priority (lower number) and longer findings win; later overlapping ones are dropped.
  all.sort((a, b) => a.priority - b.priority || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Finding[] = [];
  for (const x of all) if (!kept.some((k) => x.start < k.end && k.start < x.end)) kept.push(x);
  kept.sort((a, b) => a.start - b.start);
  return { findings: kept, tier: overallTier(kept) };
}

export function overallTier(findings: Finding[]): Tier {
  if (findings.some((x) => x.tier === "block")) return "block";
  if (findings.some((x) => x.tier === "warn")) return "warn";
  return "allow";
}

/** Shows enough of a value to recognise it without exposing it. */
export function mask(value: string): string {
  const digits = (value.match(/\p{Nd}/gu) ?? []).length;
  if (/^[\p{Nd}\s-]+$/u.test(value)) {
    let seen = 0;
    return value.replace(/\p{Nd}/gu, (d) => (++seen > digits - 2 ? d : "•"));
  }
  const v = value.replace(/\s+/g, " ");
  if (v.length <= 6) return v[0] + "•••";
  if (v.length <= 12) return v.slice(0, 2) + "•••" + v.slice(-1);
  return v.slice(0, 4) + "••••" + v.slice(-2);
}

/** Replaces each block-tier finding that has a label with "[LABEL]", working from the end. */
export function redact(text: string, findings: Finding[]): string {
  let out = text;
  for (const x of [...findings].filter((f) => f.tier === "block" && f.label).sort((a, b) => b.start - a.start)) {
    out = out.slice(0, x.start) + `[${x.label}]` + out.slice(x.end);
  }
  return out;
}

export type { Finding, Policy, ScanResult, Tier } from "./types";
