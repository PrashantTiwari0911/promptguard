import { describe, expect, it } from "vitest";
import { abn, acn, iban, luhn, medicare, mrzCheck, tfn, verhoeff } from "../src/engine/validators";
import { digitsOf, normalise } from "../src/engine/normalise";
import { mask, redact, scan } from "../src/engine/scan";

const d = (s: string) => digitsOf(s);

describe("validators", () => {
  it("Luhn", () => {
    expect(luhn(d("4242424242424242"))).toBe(true);
    expect(luhn(d("4539148803436467"))).toBe(true);
    expect(luhn(d("4539148803436468"))).toBe(false);
  });
  it("TFN (python-stdnum weights)", () => {
    expect(tfn(d("123456782"))).toBe(true); // 253 = 11 × 23
    expect(tfn(d("123456789"))).toBe(false);
    expect(tfn(d("111111111"))).toBe(false); // all-same digits rejected
  });
  it("ABN (ATO worked example)", () => {
    expect(abn(d("51824753556"))).toBe(true);
    expect(abn(d("51824753557"))).toBe(false);
  });
  it("ACN", () => expect(acn(d("000000019"))).toBe(true));
  it("Medicare", () => {
    expect(medicare(d("2123456701"))).toBe(true);
    expect(medicare(d("2123456711"))).toBe(false);
    expect(medicare(d("7123456701"))).toBe(false);
  });
  it("Verhoeff (Aadhaar)", () => {
    expect(verhoeff(d("2363"))).toBe(true);
    expect(verhoeff(d("367419502866"))).toBe(true);
    expect(verhoeff(d("367419502867"))).toBe(false);
  });
  it("IBAN", () => {
    expect(iban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(iban("GB82 WEST 1234 5698 7654 33")).toBe(false);
  });
  it("MRZ check digit (ICAO example)", () => {
    expect(mrzCheck("L898902C3", "6")).toBe(true);
    expect(mrzCheck("740812", "2")).toBe(true);
  });
});

describe("normalise", () => {
  it("keeps length so offsets map back to the original", () => {
    const s = "TFN १२३ ४५६ ７８２​!";
    expect(normalise(s).length).toBe(s.length);
    expect(normalise(s)).toBe("TFN 123 456 782 !");
  });
  it("maps unusual dashes and spaces", () => {
    expect(normalise("123–456 782")).toBe("123-456 782");
  });
});

describe("findings", () => {
  it("returns spans in the original text and a reason", () => {
    const text = "मेरा टैक्स फ़ाइल नंबर १२३ ४५६ ७८२ है";
    const r = scan(text);
    const t = r.findings.find((f) => f.detector === "tfn")!;
    expect(text.slice(t.start, t.end)).toBe("१२३ ४५६ ७८२");
    expect(t.why).toMatch(/checksum/);
  });
  it("masks values", () => {
    expect(mask("123 456 782")).toBe("••• ••• •82");
    expect(mask("AKIAZ7Q2X4M9K3L5P8RT")).toBe("AKIA••••RT");
  });
  it("redacts block findings with their label", () => {
    const text = "TFN 123 456 782 and card 4539 1488 0343 6467, test 4242 4242 4242 4242";
    expect(redact(text, scan(text).findings)).toBe("TFN [TFN] and card [CARD], test 4242 4242 4242 4242");
  });
});
