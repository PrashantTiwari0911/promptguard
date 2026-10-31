// Prints checksum-valid synthetic identifiers for test data. None belongs to a real person.
import { abn, luhn, medicare, tfn, verhoeff } from "../src/engine/validators";

const rand = (k: number) => Array.from({ length: k }, () => Math.floor(Math.random() * 10));
function find(len: number, ok: (d: number[]) => boolean, first?: number): string {
  for (;;) {
    const d = rand(len);
    if (first !== undefined) d[0] = first;
    if (ok(d)) return d.join("");
  }
}
console.log("tfn       ", find(9, tfn));
console.log("abn       ", find(11, abn, 5));
console.log("aadhaar   ", find(12, verhoeff, 4));
console.log("medicare  ", find(10, medicare, 3));
console.log("visa      ", find(16, (d) => d[0] === 4 && luhn(d), 4));
console.log("mastercard", find(16, (d) => d[1] >= 1 && d[1] <= 5 && luhn(d), 5));
