// Normalisation that keeps every offset valid: each UTF-16 unit maps to exactly one unit,
// so a finding's [start, end) in the normalised text is the same span in the original.

/** Code points of "0" for every decimal-digit block we fold to ASCII. */
const ZEROS = [
  0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6,
  0xe50, 0xed0, 0xf20, 0x1040, 0x17e0, 0x1810, 0x1946, 0x19d0, 0xff10,
];

const SPACE_LIKE = new RegExp("[\\u00A0\\u1680\\u2000-\\u200D\\u2028\\u2029\\u202F\\u205F\\u2060\\u3000\\uFEFF\\u00AD]");
const DASH_LIKE = new RegExp("[\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D]");

export function normalise(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const ch = text[i];
    let mapped: string | null = null;
    for (const zero of ZEROS) {
      if (code >= zero && code <= zero + 9) {
        mapped = String(code - zero);
        break;
      }
    }
    if (mapped === null) {
      if (code >= 0xff01 && code <= 0xff5e) mapped = String.fromCharCode(code - 0xfee0); // full-width ASCII
      else if (SPACE_LIKE.test(ch)) mapped = " ";
      else if (DASH_LIKE.test(ch)) mapped = "-";
      else mapped = ch;
    }
    out += mapped;
  }
  return out;
}

export const digitsOf = (s: string): number[] => {
  const d: number[] = [];
  for (const ch of s) if (ch >= "0" && ch <= "9") d.push(ch.charCodeAt(0) - 48);
  return d;
};
