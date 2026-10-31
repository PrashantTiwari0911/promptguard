// Latency benchmark (p50/p95 per input size) and a false-positive sweep over benign source files.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../src/engine/scan";

const prose = "Our quarterly planning notes cover hiring, the roadmap, customer feedback and the launch checklist. Order #4471 shipped on 3 Nov. ";
const code = "function total(items) {\n  return items.reduce((s, x) => s + x.price * x.qty, 0);\n}\n";
const sample = (size: number) => {
  let s = "";
  while (s.length < size) s += Math.random() < 0.5 ? prose : code;
  return s.slice(0, size) + " TFN 123 456 782";
};

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

console.log("Latency (ms)");
for (const size of [1_000, 10_000, 100_000, 1_000_000]) {
  const text = sample(size);
  const runs = size >= 1_000_000 ? 10 : 50;
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const a = performance.now();
    const r = scan(text);
    t.push(performance.now() - a);
    if (r.tier !== "block") throw new Error("benchmark text should block");
  }
  console.log(`  ${String(size).padStart(9)} chars  p50 ${pct(t, 50).toFixed(2).padStart(7)}  p95 ${pct(t, 95).toFixed(2).padStart(7)}`);
}

// ReDoS guard: adversarial strings for the heavier patterns must stay fast.
const adversarial = [
  "a".repeat(200_000), "1 ".repeat(100_000), "password=" + "x".repeat(100_000), "-".repeat(200_000),
  "eyJ" + "a".repeat(100_000), "postgres://" + "a:".repeat(50_000), ("Aa1!".repeat(16) + " ").repeat(3000),
];
let worst = 0;
for (const s of adversarial) {
  const a = performance.now();
  scan(s);
  worst = Math.max(worst, performance.now() - a);
}
console.log(`Adversarial inputs: worst ${worst.toFixed(1)} ms`);

// False-positive sweep over source files that should contain no real secrets.
const root = process.argv[2] ?? "node_modules";
const files: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!/test|fixture|__tests__|spec/i.test(e)) walk(p); }
    else if (/\.(js|ts|md|json|py|txt)$/.test(e) && st.size < 200_000 && st.size > 200) files.push(p);
  }
})(root);
let blocked = 0, warned = 0;
const byDetector = new Map<string, number>();
const examples: string[] = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const r = scan(text);
  if (r.tier === "block") {
    blocked++;
    for (const x of r.findings.filter((y) => y.tier === "block")) {
      byDetector.set(x.detector, (byDetector.get(x.detector) ?? 0) + 1);
      if (examples.length < 25) examples.push(`${x.detector}  ${file}  ${JSON.stringify(text.slice(x.start, x.end).slice(0, 60))}`);
    }
  } else if (r.tier === "warn") warned++;
}
console.log(`\nBenign sweep: ${files.length} files, blocked ${blocked} (${((blocked / files.length) * 100).toFixed(2)}%), warned ${warned}`);
console.log([...byDetector].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
console.log(examples.join("\n"));
