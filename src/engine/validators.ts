// Checksum and structure validators. Each takes digits (or a string) and returns true when valid.

export function luhn(d: number[]): boolean {
  if (d.length < 2) return false;
  let sum = 0;
  for (let i = d.length - 1, k = 0; i >= 0; i--, k++) {
    let x = d[i];
    if (k % 2) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
  }
  return sum % 10 === 0;
}

// python-stdnum au/tfn.py: 8-digit TFNs use the first eight weights.
const TFN_W = [1, 4, 3, 7, 5, 8, 6, 9, 10];
export function tfn(d: number[]): boolean {
  if (d.length !== 8 && d.length !== 9) return false;
  if (d.every((x) => x === d[0])) return false;
  return d.reduce((s, x, i) => s + x * TFN_W[i], 0) % 11 === 0;
}

const ABN_W = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
export function abn(d: number[]): boolean {
  if (d.length !== 11 || d[0] === 0) return false;
  return d.reduce((s, x, i) => s + (i === 0 ? x - 1 : x) * ABN_W[i], 0) % 89 === 0;
}

const ACN_W = [8, 7, 6, 5, 4, 3, 2, 1];
export function acn(d: number[]): boolean {
  if (d.length !== 9) return false;
  const s = d.slice(0, 8).reduce((a, x, i) => a + x * ACN_W[i], 0);
  return (10 - (s % 10)) % 10 === d[8];
}

const MED_W = [1, 3, 7, 9, 1, 3, 7, 9];
export function medicare(d: number[]): boolean {
  if (d.length < 10 || d.length > 11 || d[0] < 2 || d[0] > 6) return false;
  return d.slice(0, 8).reduce((s, x, i) => s + x * MED_W[i], 0) % 10 === d[8];
}

const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
/** Verhoeff check (used by Aadhaar). */
export function verhoeff(d: number[]): boolean {
  let c = 0;
  const r = [...d].reverse();
  for (let i = 0; i < r.length; i++) c = VD[c][VP[i % 8][r[i]]];
  return c === 0;
}

/** ISO 13616 IBAN, mod 97. */
export function iban(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
}

/** ICAO 9303 check digit (weights 7, 3, 1) over a field of the machine-readable zone. */
export function mrzCheck(field: string, check: string): boolean {
  const W = [7, 3, 1];
  let s = 0;
  for (let i = 0; i < field.length; i++) {
    const ch = field[i];
    const v = ch === "<" ? 0 : /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55;
    s += v * W[i % 3];
  }
  return String(s % 10) === check;
}

export function shannon(s: string): number {
  const f = new Map<string, number>();
  for (const ch of s) f.set(ch, (f.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of f.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
