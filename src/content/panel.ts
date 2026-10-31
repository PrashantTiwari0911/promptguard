// The block panel. Lives in a Shadow DOM so the chat site's CSS can't reach it and ours can't leak.
// It never takes focus: a second Enter in the composer must hit the guard again, not a panel button.
import { mask } from "../engine/scan";
import type { Finding, Tier } from "../engine/types";

export interface Segment {
  /** "Your message", "Pasted text 1", 'File "notes.csv"'. */
  label: string;
  text: string;
  findings: Finding[];
  chip?: HTMLElement;
}

export interface PanelActions {
  redact(): number;
  highlight(f: Finding): void;
  removeChip(chip: HTMLElement): void;
  sendAnyway(reason: string): void;
}

const CSS = `
:host { all: initial; }
.wrap { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); width: min(620px, calc(100vw - 32px));
  max-height: min(70vh, 560px); overflow: auto; z-index: 2147483647; box-sizing: border-box;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1B2430; background: #fff;
  border: 1px solid #CBD2DB; border-radius: 12px; box-shadow: 0 12px 32px rgba(27,36,48,.18); }
.head { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: #FBE4E1; color: #8E1B12; border-radius: 12px 12px 0 0; }
.head.warn { background: #FAEFB5; color: #5A4500; }
.head.ok { background: #DCEFE4; color: #1F5E43; }
.head h2 { margin: 0; font-size: 15px; font-weight: 700; flex: 1; }
.head p { margin: 2px 0 0; font-size: 13px; font-weight: 400; }
.x { all: unset; cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.x:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid #3B5BA9; outline-offset: 2px; }
.body { padding: 6px 14px 12px; }
.group { margin-top: 8px; font-size: 12px; font-weight: 600; color: #4F5A6B; }
ul { list-style: none; margin: 4px 0 0; padding: 0; }
li { border-top: 1px solid #E7EBF0; padding: 8px 0; display: grid; grid-template-columns: auto 1fr auto; gap: 2px 10px; align-items: start; }
.tag { font-size: 11px; font-weight: 700; border-radius: 3px; padding: 1px 6px; margin-top: 2px; }
.tag.block { background: #FBE4E1; color: #B42318; } .tag.warn { background: #FAEFB5; color: #5A4500; }
.what { font-weight: 600; }
.what code { font: 12px ui-monospace, Menlo, Consolas, monospace; background: #E8ECF1; padding: 1px 5px; border-radius: 3px; font-weight: 400; }
.why { grid-column: 2; color: #4F5A6B; font-size: 13px; }
.link { all: unset; cursor: pointer; color: #3B5BA9; font-size: 13px; font-weight: 600; white-space: nowrap; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
.btn { all: unset; cursor: pointer; font-weight: 600; font-size: 13px; padding: 7px 12px; border-radius: 999px; border: 1px solid #CBD2DB; background: #F2F4F6; }
.btn.pri { background: #3B5BA9; border-color: #3B5BA9; color: #fff; }
.note { color: #4F5A6B; font-size: 12px; }
.reason { display: none; gap: 8px; margin-top: 10px; }
.reason.on { display: flex; }
.reason input { flex: 1; font: inherit; padding: 6px 10px; border: 1px solid #CBD2DB; border-radius: 8px; }
@media (prefers-color-scheme: dark) {
  .wrap { background: #181D25; color: #E4E8EE; border-color: #353D49; }
  .head { background: #3B201D; color: #FFB4A9; } .head.warn { background: #3A3416; color: #F3DA7A; } .head.ok { background: #17302A; color: #8FE0B8; }
  li { border-color: #2A313B; } .why, .group, .note { color: #9BA6B5; } .what code { background: #1C222B; }
  .btn { background: #1F252E; border-color: #353D49; color: #E4E8EE; } .btn.pri { background: #93ABEB; border-color: #93ABEB; color: #11151B; }
  .link { color: #93ABEB; } .reason input { background: #11151B; color: #E4E8EE; border-color: #353D49; }
}
@media (prefers-reduced-motion: no-preference) { .wrap { animation: rise .14s ease-out; } }
@keyframes rise { from { transform: translate(-50%, 8px); opacity: 0; } }
`;

export class Panel {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private hideTimer = 0;
  visible = false;

  constructor(private actions: PanelActions) {}

  private ensure(): ShadowRoot {
    if (this.root && this.host?.isConnected) return this.root;
    this.host = document.createElement("div");
    this.host.id = "promptguard-panel";
    this.root = this.host.attachShadow({ mode: "open" });
    (document.body ?? document.documentElement).appendChild(this.host);
    return this.root;
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    if (this.root) this.root.innerHTML = "";
    this.visible = false;
  }

  /** Shows that the prompt is now clean, then closes. */
  showClear(): void {
    const root = this.ensure();
    root.innerHTML = `<style>${CSS}</style><div class="wrap" role="status"><div class="head ok" style="border-radius:12px"><h2>Fixed. Nothing high-risk left, so you can send now.</h2></div></div>`;
    this.visible = true;
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), 1800);
  }

  show(segments: Segment[], tier: Tier, note = ""): void {
    window.clearTimeout(this.hideTimer);
    const root = this.ensure();
    const flagged = segments.flatMap((s) => s.findings.filter((f) => f.tier !== "allow").map((f) => ({ s, f })));
    const nBlock = flagged.filter((x) => x.f.tier === "block").length;
    const title = tier === "block"
      ? `Not sent: ${nBlock} high-risk item${nBlock === 1 ? "" : "s"} found`
      : `Check before sending: ${flagged.length} possible sensitive item${flagged.length === 1 ? "" : "s"}`;
    const sub = tier === "block"
      ? "These can identify a person or give access to systems. Remove or redact them; the prompt is checked again as you edit."
      : "These might be sensitive. Edit the prompt, or send it anyway with a short reason.";

    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.setAttribute("role", "alert");
    wrap.setAttribute("aria-labelledby", "pg-title");
    wrap.setAttribute("aria-describedby", "pg-sub");
    wrap.innerHTML = `<div class="head ${tier === "block" ? "" : "warn"}"><div style="flex:1"><h2 id="pg-title"></h2><p id="pg-sub"></p></div><button class="x" type="button" aria-label="Close">×</button></div><div class="body"></div>`;
    (wrap.querySelector("#pg-title") as HTMLElement).textContent = title;
    (wrap.querySelector("#pg-sub") as HTMLElement).textContent = sub;
    const body = wrap.querySelector(".body") as HTMLElement;

    for (const seg of segments) {
      const items = seg.findings.filter((f) => f.tier !== "allow");
      if (!items.length) continue;
      const g = document.createElement("div");
      g.className = "group";
      g.textContent = seg.label;
      body.appendChild(g);
      const ul = document.createElement("ul");
      for (const f of items) {
        const li = document.createElement("li");
        const value = seg.text.slice(f.start, f.end);
        li.innerHTML = `<span class="tag ${f.tier}"></span><span class="what"></span><span></span><span class="why"></span>`;
        (li.children[0] as HTMLElement).textContent = f.tier === "block" ? "Block" : "Check";
        const what = li.children[1] as HTMLElement;
        what.textContent = f.what + " ";
        if (f.label) {
          const c = document.createElement("code");
          c.textContent = mask(value);
          what.appendChild(c);
        }
        (li.children[3] as HTMLElement).textContent = f.why;
        if (!seg.chip) {
          const b = document.createElement("button");
          b.className = "link";
          b.type = "button";
          b.textContent = "Show";
          b.addEventListener("click", () => this.actions.highlight(f));
          li.children[2].replaceWith(b);
        }
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    const msg = segments.find((s) => !s.chip);
    if (msg && msg.findings.some((f) => f.tier === "block" && f.label)) {
      const b = this.button("Redact in message", true);
      b.addEventListener("click", () => {
        const n = this.actions.redact();
        if (!n) this.note(actions, "Couldn't replace the text automatically. Use Show and edit it by hand.");
      });
      actions.appendChild(b);
    }
    for (const seg of segments) {
      if (seg.chip && seg.findings.some((f) => f.tier !== "allow")) {
        const b = this.button(`Remove ${seg.label.charAt(0).toLowerCase()}${seg.label.slice(1)}`, false);
        b.addEventListener("click", () => this.actions.removeChip(seg.chip!));
        actions.appendChild(b);
      }
    }
    if (tier === "warn") {
      const b = this.button("Send anyway", false);
      const form = document.createElement("div");
      form.className = "reason";
      form.innerHTML = `<input type="text" aria-label="Reason for sending" placeholder="Why is this safe to send?" maxlength="200"><button class="btn pri" type="button">Send</button>`;
      const input = form.querySelector("input") as HTMLInputElement;
      const send = form.querySelector("button") as HTMLButtonElement;
      b.addEventListener("click", () => { form.classList.add("on"); input.focus(); });
      const go = () => {
        if (input.value.trim().length < 3) { input.focus(); input.placeholder = "Add a short reason (3+ characters)"; return; }
        this.actions.sendAnyway(input.value.trim());
      };
      send.addEventListener("click", go);
      input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") go(); });
      actions.appendChild(b);
      body.appendChild(actions);
      body.appendChild(form);
    } else {
      body.appendChild(actions);
    }
    if (note) this.note(actions, note);

    wrap.querySelector(".x")!.addEventListener("click", () => this.hide());
    wrap.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") this.hide(); });

    root.innerHTML = `<style>${CSS}</style>`;
    root.appendChild(wrap);
    this.visible = true;
  }

  private button(text: string, primary: boolean): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = primary ? "btn pri" : "btn";
    b.textContent = text;
    return b;
  }

  private note(parent: HTMLElement, text: string): void {
    const s = document.createElement("span");
    s.className = "note";
    s.textContent = text;
    parent.appendChild(s);
  }
}
