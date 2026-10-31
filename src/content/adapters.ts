// One adapter per chat site. Selectors were read from the live sites on 28 Oct 2026; each list ends
// with generic fallbacks so a markup change degrades to "still works, less precisely".

export interface SiteAdapter {
  name: string;
  composer(): HTMLElement | null;
  isComposer(el: EventTarget | null): boolean;
  isSendTarget(el: EventTarget | null): boolean;
  sendButton(): HTMLElement | null;
  /** Attachment chips currently shown in the composer. */
  chips(): HTMLElement[];
  /** Visible preview text of a chip (the full text is not in the DOM). */
  chipPreview(chip: HTMLElement): string;
  removeChip(chip: HTMLElement): boolean;
}

const GENERIC_COMPOSER = 'div.ProseMirror[contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea';
const GENERIC_SEND = 'button[aria-label*="Send" i], button[data-testid*="send" i]';

function closestMatch(el: EventTarget | null, selector: string): HTMLElement | null {
  return el instanceof Element ? (el.closest(selector) as HTMLElement | null) : null;
}

function makeAdapter(cfg: {
  name: string;
  composer: string;
  send: string;
  chip?: string;
  chipRemove: string;
}): SiteAdapter {
  const composer = () =>
    (document.querySelector(cfg.composer) as HTMLElement | null) ?? (document.querySelector(GENERIC_COMPOSER) as HTMLElement | null);
  const scope = () => composer()?.closest("form, fieldset, [data-testid*=composer], main") ?? document.body;

  const chipsFromRemoveButtons = (): HTMLElement[] => {
    const out: HTMLElement[] = [];
    scope().querySelectorAll<HTMLElement>(cfg.chipRemove).forEach((btn) => {
      // Climb to the smallest ancestor that also holds the preview text.
      let el: HTMLElement | null = btn.parentElement;
      for (let i = 0; i < 4 && el && (el.innerText ?? "").trim().length < 12; i++) el = el.parentElement;
      if (el && !out.includes(el)) out.push(el);
    });
    return out;
  };

  return {
    name: cfg.name,
    composer,
    isComposer: (el) => !!closestMatch(el, cfg.composer) || !!closestMatch(el, GENERIC_COMPOSER),
    isSendTarget: (el) => {
      const b = closestMatch(el, cfg.send) ?? closestMatch(el, GENERIC_SEND);
      return !!b && !/stop|cancel/i.test(b.getAttribute("aria-label") ?? "");
    },
    sendButton: () => (document.querySelector(cfg.send) as HTMLElement | null) ?? (document.querySelector(GENERIC_SEND) as HTMLElement | null),
    chips: () => {
      const direct = cfg.chip ? Array.from(document.querySelectorAll<HTMLElement>(cfg.chip)) : [];
      return direct.length ? direct : chipsFromRemoveButtons();
    },
    chipPreview: (chip) => {
      const lines = (chip.innerText ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      const best = lines.sort((a, b) => b.length - a.length)[0] ?? "";
      return best.replace(/[……]+$|\.\.\.$/, "").trim();
    },
    removeChip: (chip) => {
      const btn =
        chip.querySelector<HTMLElement>(cfg.chipRemove) ??
        chip.parentElement?.querySelector<HTMLElement>(cfg.chipRemove) ??
        chip.parentElement?.parentElement?.querySelector<HTMLElement>(cfg.chipRemove);
      btn?.click();
      return !!btn;
    },
  };
}

export const ADAPTERS: Record<string, SiteAdapter> = {
  "claude.ai": makeAdapter({
    name: "claude.ai",
    composer: '[data-testid="chat-input"], div.ProseMirror[contenteditable="true"]',
    send: 'button[data-testid="chat-input-send"], button[aria-label="Send message"], button[aria-label="Send Message"]',
    chip: '[data-testid="file-thumbnail"]',
    chipRemove: 'button[aria-label^="Remove"]',
  }),
  "chatgpt.com": makeAdapter({
    name: "chatgpt.com",
    composer: '#prompt-textarea, form div.ProseMirror[contenteditable="true"]',
    send: '#composer-submit-button, button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]',
    chipRemove: 'button[aria-label="Remove pasted text attachment"], button[aria-label^="Remove file"], button[aria-label^="Remove"]',
  }),
  "gemini.google.com": makeAdapter({
    name: "gemini.google.com",
    composer: 'rich-textarea .ql-editor, div.ql-editor[contenteditable="true"]',
    send: 'button[aria-label="Send message"], button.send-button',
    chipRemove: 'button[aria-label^="Remove"], button[aria-label*="remove" i]',
  }),
};

export function adapterFor(location: Location): SiteAdapter | null {
  const host = location.hostname.replace(/^www\./, "");
  return ADAPTERS[host] ?? null;
}

export function composerText(el: HTMLElement | null): string {
  if (!el) return "";
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.innerText ?? el.textContent ?? "";
}
