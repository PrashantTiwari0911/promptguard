// Helpers that look around a match: preceding text, the surrounding line, and the record it sits in.

export const before = (n: string, i: number, len = 50): string => n.slice(Math.max(0, i - len), i);
export const after = (n: string, i: number, len = 50): string => n.slice(i, i + len);

export function lineAround(n: string, start: number, end: number): string {
  const a = n.lastIndexOf("\n", start - 1) + 1;
  const b = n.indexOf("\n", end);
  return n.slice(a, b < 0 ? n.length : b);
}

export interface Record {
  start: number;
  text: string;
}

/** Splits text into records: paragraphs separated by blank lines. */
export function records(n: string): Record[] {
  const out: Record[] = [];
  const re = /\n[ \t]*\n/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n))) {
    if (m.index > last) out.push({ start: last, text: n.slice(last, m.index) });
    last = m.index + m[0].length;
  }
  if (last < n.length) out.push({ start: last, text: n.slice(last) });
  return out;
}

/** Header row of a CSV-looking record, if the record looks like CSV. */
export function csvHeader(rec: string): string[] | null {
  const lines = rec.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const cols = lines[0].split(/[,\t;]/).map((c) => c.trim().toLowerCase());
  if (cols.length < 2) return null;
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  if (!lines.slice(1, 4).every((l) => l.split(sep).length >= cols.length - 1)) return null;
  return cols;
}

/** Column header for a match inside a CSV record, or null. */
export function csvColumnOf(n: string, rec: Record, index: number): string | null {
  const header = csvHeader(rec.text);
  if (!header) return null;
  const firstNl = rec.text.indexOf("\n");
  if (index - rec.start <= firstNl) return null;
  const lineStart = n.lastIndexOf("\n", index - 1) + 1;
  const prefix = n.slice(lineStart, index);
  const sep = rec.text.slice(0, firstNl).includes("\t") ? "\t" : rec.text.slice(0, firstNl).includes(";") ? ";" : ",";
  const col = prefix.split(sep).length - 1;
  return header[col] ?? null;
}

/** CSV column header for the cell at `index`, or null when the text there is not CSV. */
export function csvColumnAt(n: string, index: number): string | null {
  const blank = n.lastIndexOf("\n\n", index);
  const start = blank < 0 ? 0 : blank + 2;
  const endBlank = n.indexOf("\n\n", index);
  return csvColumnOf(n, { start, text: n.slice(start, endBlank < 0 ? n.length : endBlank) }, index);
}

/** JSON key immediately before a value, e.g. `"tfn": "123…"`. */
export function jsonKeyBefore(n: string, i: number): string | null {
  const m = before(n, i, 60).match(/["']([\w\s-]{1,40})["']\s*:\s*["']?$/);
  return m ? m[1].toLowerCase() : null;
}

const NOT_NAMES = new Set([
  "The", "This", "That", "Please", "Hi", "Hello", "Dear", "Can", "Could", "Order", "Invoice", "Customer",
  "Patient", "Name", "Card", "Account", "Tax", "File", "Number", "Australian", "Business", "New", "South",
  "Wales", "Pty", "Ltd", "Test", "Use", "My", "Her", "His", "Our", "Their", "Mr", "Ms", "Mrs", "Dr",
]);

/** Finds a likely person's name: an honorific + name, a labelled name, or two capitalised words. */
export function personName(text: string): string | null {
  const hon = text.match(/\b(?:Mr|Ms|Mrs|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?/);
  if (hon) return hon[0];
  const lab = text.match(/\b(?:name|full name|customer|client|contractor|employee|patient|sole trader|director|holder)\s*[:=-]\s*([A-Z][a-z]+(?:\s[A-Z][a-z'-]+)+)/i);
  if (lab) return lab[1];
  const re = /\b([A-Z][a-z]{1,20})\s([A-Z][a-z'-]{1,20})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (!NOT_NAMES.has(m[1]) && !NOT_NAMES.has(m[2])) return m[0];
  return null;
}

export const COMPANY = /\b(?:Pty|Ltd|Limited|Inc|LLC|Group|Holdings|Corp|Corporation|Bank|Council|University|Foundation|Trust)\b/;
