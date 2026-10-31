// Content script (isolated world). Catches every send attempt in the capture phase, before the chat
// app's own handlers, and decides synchronously: clean prompts pass untouched, dirty ones are stopped.
import { overallTier, scan } from "../engine/scan";
import type { Finding, ScanResult, Tier } from "../engine/types";
import { adapterFor, composerText } from "./adapters";
import { ChipTracker } from "./chips";
import { Panel, type Segment } from "./panel";

const adapter = adapterFor(location);

if (adapter) {
  const cache = new Map<string, ScanResult>();
  const scanCached = (text: string): ScanResult => {
    let r = cache.get(text);
    if (!r) {
      r = scan(text);
      cache.set(text, r);
      if (cache.size > 30) cache.delete(cache.keys().next().value as string);
    }
    return r;
  };

  // Text the user confirmed through "Send anyway" (warn tier only). Valid for that exact text, for two seconds,
  // so the click and the form submit it triggers both pass.
  let oneShot = { text: "", until: 0 };
  let lastSegments: Segment[] = [];

  const collect = (): Segment[] => {
    const segs: Segment[] = [];
    const msg = composerText(adapter.composer());
    if (msg.trim()) segs.push({ label: "Your message", text: msg, findings: scanCached(msg).findings });
    for (const c of chips.live()) {
      if (c.entry) segs.push({ label: c.label, text: c.entry.text, findings: scanCached(c.entry.text).findings, chip: c.chip });
    }
    return segs;
  };
  const tierOf = (segs: Segment[]): Tier => overallTier(segs.flatMap((s) => s.findings));
  const joined = (segs: Segment[]) => segs.map((s) => s.text).join("\u0000");

  const panel = new Panel({
    redact: () => redactInComposer(lastSegments.find((s) => !s.chip)?.findings ?? []),
    highlight: (f) => selectInComposer(lastSegments.find((s) => !s.chip)?.text ?? "", f, false),
    removeChip: (chip) => {
      if (!adapter.removeChip(chip)) chip.querySelector<HTMLElement>("button")?.click();
      window.setTimeout(refresh, 250);
    },
    sendAnyway: (reason) => {
      oneShot = { text: joined(collect()), until: Date.now() + 2000 };
      console.info("[PromptGuard] sent after warning; reason:", reason);
      panel.hide();
      adapter.sendButton()?.click();
    },
  });

  const chips = new ChipTracker(adapter, () => refresh());

  /** The guard. Runs inside the original event; returns without touching it when the prompt is clean. */
  const guard = (e: Event): void => {
    const segs = collect();
    if (!segs.length) return;
    const t0 = performance.now();
    const tier = tierOf(segs);
    const ms = performance.now() - t0;
    if (tier === "allow") return;
    if (tier === "warn" && oneShot.text === joined(segs) && Date.now() < oneShot.until) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    lastSegments = segs;
    panel.show(segs, tier);
    document.documentElement.dataset.promptguard = tier;
    if (e.type === "click" || e.type === "keydown") console.info(`[PromptGuard] ${tier} in ${ms.toFixed(1)} ms`);
  };

  /** Re-checks while the panel is open, so fixes take effect immediately. */
  let refreshTimer = 0;
  function refresh(): void {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      chips.prune();
      if (!panel.visible) return;
      const segs = collect();
      lastSegments = segs;
      const tier = tierOf(segs);
      if (tier === "allow") {
        document.documentElement.dataset.promptguard = "allow";
        panel.showClear();
      } else panel.show(segs, tier);
    }, 150);
  }

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    if (!adapter.isComposer(e.target)) return;
    guard(e);
  }, true);
  for (const type of ["pointerdown", "mousedown", "click"]) {
    window.addEventListener(type, (e) => { if (adapter.isSendTarget(e.target)) guard(e); }, true);
  }
  window.addEventListener("submit", (e) => {
    const form = e.target;
    const comp = adapter.composer();
    if (form instanceof HTMLFormElement && comp && form.contains(comp)) guard(e);
  }, true);

  window.addEventListener("paste", (e) => { if (adapter.isComposer(e.target)) { chips.onPaste(e); refresh(); } }, true);
  window.addEventListener("drop", (e) => { chips.onFiles((e as DragEvent).dataTransfer?.files); }, true);
  window.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t?.type === "file") chips.onFiles(t.files);
  }, true);
  window.addEventListener("input", (e) => { if (adapter.isComposer(e.target)) refresh(); }, true);

  const startObserver = () => new MutationObserver(() => { if (panel.visible) refresh(); }).observe(document.body, { childList: true, subtree: true });
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver, { once: true });

  // Messages from the network backstop in the page's own world.
  window.addEventListener("promptguard:backstop", (e) => {
    const detail = (e as CustomEvent<string>).detail;
    let items: Array<{ what: string; why: string }> = [];
    try { items = JSON.parse(String(detail)); } catch { /* ignore */ }
    const findings: Finding[] = items.map((x, i) => ({ category: 1, detector: "backstop", what: x.what, why: x.why, tier: "block", start: i, end: i, label: "", priority: 0 }));
    panel.show([{ label: "Request stopped by the network check", text: "", findings }], "block", "The app tried to send this through another route, so the request was stopped.");
  });

  // ---------------------------------------------------------------- editing the composer
  function textNodesOf(root: Node): Text[] {
    const out: Text[] = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
    return out;
  }

  /** Selects the finding's value in the composer. Returns false when it spans several nodes. */
  function selectInComposer(segText: string, f: Finding, forEdit: boolean): boolean {
    const comp = adapter!.composer();
    if (!comp) return false;
    const value = segText.slice(f.start, f.end);
    // Which occurrence of this value is it? Count earlier ones so repeated values map correctly.
    let nth = 0;
    for (let i = segText.indexOf(value); i >= 0 && i < f.start; i = segText.indexOf(value, i + 1)) nth++;
    let seen = 0;
    for (const node of textNodesOf(comp)) {
      for (let i = node.data.indexOf(value); i >= 0; i = node.data.indexOf(value, i + 1)) {
        if (seen++ < nth) continue;
        comp.focus();
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + value.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        if (!forEdit) node.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
        return true;
      }
    }
    return false;
  }

  /** Replaces each blocked value in the composer with [LABEL], through the editor's own input path. */
  function redactInComposer(findings: Finding[]): number {
    const seg = lastSegments.find((s) => !s.chip);
    if (!seg) return 0;
    let done = 0;
    for (const f of [...findings].filter((x) => x.tier === "block" && x.label).sort((a, b) => b.start - a.start)) {
      if (selectInComposer(seg.text, f, true) && document.execCommand("insertText", false, `[${f.label}]`)) done++;
    }
    refresh();
    return done;
  }
}
