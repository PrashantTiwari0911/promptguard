// Keeps the full text behind paste and file chips. The chat sites show only a short preview of a
// large paste, so the text has to be captured at paste (or drop/upload) time.
import type { SiteAdapter } from "./adapters";

export interface Captured {
  id: number;
  text: string;
  /** File name for uploads, empty for pastes. */
  name: string;
  key: string;
  at: number;
}

export interface LiveChip {
  chip: HTMLElement;
  entry: Captured | null;
  label: string;
}

const MIN_PASTE = 500;
const TEXT_FILE = /\.(txt|md|csv|tsv|json|jsonl|xml|ya?ml|log|env|ini|conf|cfg|sql|py|js|ts|tsx|jsx|java|kt|go|rb|php|cs|c|cpp|h|hpp|rs|sh|ps1|html|css|properties|pem|key)$/i;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export class ChipTracker {
  private entries: Captured[] = [];
  private seq = 0;

  constructor(private adapter: SiteAdapter, private onChange: () => void) {}

  /** Called from a capture-phase paste listener; never blocks the paste itself. */
  onPaste(e: ClipboardEvent): void {
    const dt = e.clipboardData;
    if (!dt) return;
    const text = dt.getData("text/plain");
    if (text && text.length >= MIN_PASTE) this.add(text, "");
    this.readFiles(dt.files);
  }

  onFiles(files: FileList | null | undefined): void {
    this.readFiles(files);
  }

  private readFiles(files: FileList | null | undefined): void {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.size > 5_000_000 || !(TEXT_FILE.test(file.name) || file.type.startsWith("text/") || file.type === "application/json")) continue;
      file.text().then((t) => { this.add(t, file.name); this.onChange(); }).catch(() => {});
    }
  }

  private add(text: string, name: string): void {
    this.entries.push({ id: ++this.seq, text, name, key: squash(text).slice(0, 400), at: Date.now() });
    if (this.entries.length > 50) this.entries.shift();
  }

  /** Chips on screen now, each matched to its captured text when possible. */
  live(): LiveChip[] {
    const chips = this.adapter.chips();
    const used = new Set<number>();
    const out: LiveChip[] = chips.map((chip, i) => {
      const preview = squash(this.adapter.chipPreview(chip));
      const all = squash(chip.innerText ?? "");
      let entry =
        this.entries.find((e) => !used.has(e.id) && e.name && all.includes(e.name)) ??
        (preview.length >= 12 ? this.entries.find((e) => !used.has(e.id) && !e.name && e.key.startsWith(preview.slice(0, 60))) : undefined) ??
        null;
      if (entry) used.add(entry.id);
      return { chip, entry, label: entry?.name ? `File "${entry.name}"` : `Pasted text ${i + 1}` };
    });
    // Previews can be unreadable (an image thumbnail, a new layout). Pair leftovers by order.
    const spare = this.entries.filter((e) => !used.has(e.id) && !this.isInline(e));
    for (const c of out) {
      if (!c.entry && spare.length) {
        c.entry = spare.pop()!;
        used.add(c.entry.id);
      }
    }
    return out;
  }

  private isInline(e: Captured): boolean {
    const comp = this.adapter.composer();
    return !!comp && squash(comp.innerText ?? "").includes(e.key.slice(0, 120));
  }

  /** Drops captured text whose chip has gone, so removing a chip lifts the block. */
  prune(): void {
    const keep = new Set(this.live().map((c) => c.entry?.id).filter(Boolean) as number[]);
    const now = Date.now();
    // Recent captures may not have a chip yet (the site is still rendering it), so keep them briefly.
    this.entries = this.entries.filter((e) => keep.has(e.id) || now - e.at < 3000);
  }
}
