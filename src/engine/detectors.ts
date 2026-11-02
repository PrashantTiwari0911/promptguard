// Detectors for the ten categories in the brief. Each detector runs over the normalised text `n`
// (same offsets as the original) and returns findings; overlap resolution happens in scan.ts.
import { digitsOf } from "./normalise";
import { abn, iban, luhn, medicare, mrzCheck, shannon, tfn, verhoeff } from "./validators";
import { COMPANY, after, before, csvColumnAt, csvHeader, jsonKeyBefore, lineAround, personName, records } from "./context";
import type { Category, Finding, Policy, Tier } from "./types";

export interface Ctx {
  n: string;
  policy: Policy;
}
type Detector = (ctx: Ctx) => Finding[];

function each(re: RegExp, n: string, fn: (m: RegExpExecArray) => Finding | Finding[] | null | undefined): Finding[] {
  const out: Finding[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n))) {
    const r = fn(m);
    if (r) out.push(...(Array.isArray(r) ? r : [r]));
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function f(
  category: Category, detector: string, tier: Tier, start: number, end: number,
  what: string, why: string, label: string, priority: number,
): Finding {
  return { category, detector, tier, start, end, what, why, label, priority };
}

/** Values people write instead of a real secret. */
const PLACEHOLDER = /^(?:\*+|x{3,}|X{3,}|•+|\.{3}|<[^>]*>|\{\{?[^}]*\}?\}|\$\{?[\w.]+\}?|%[\w]+%|your[_-]?\w*|example\w*|changeme|redacted|null|none|undefined|todo|tbd|placeholder|secret|password|pass|test|dummy|sample|my[_-]?\w+)$/i;

// ---------------------------------------------------------------- 1. API keys and access tokens
// Distinctive prefixes have no leading \b, so a key glued to a word ("hellosk-ant-…") is still found.
// The OpenAI "sk-" prefix also occurs inside words ("risk-assessment-…"), so it needs a key-like body.
const keyLike = (s: string) => /\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s);
const PROVIDER_KEYS: Array<[RegExp, string, ((s: string) => boolean)?]> = [
  [/sk-ant-[A-Za-z0-9]{3,10}-[A-Za-z0-9_-]{20,}/g, "Anthropic API key"],
  [/sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g, "OpenAI API key", keyLike],
  [/(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}(?![0-9A-Z])/g, "AWS access key"],
  [/(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g, "GitHub token"],
  [/glpat-[A-Za-z0-9_-]{20,}/g, "GitLab token"],
  [/xox[abposr]-[A-Za-z0-9-]{10,}/g, "Slack token"],
  [/https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/g, "Slack webhook URL"],
  [/AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g, "Google API key"],
  [/GOCSPX-[A-Za-z0-9_-]{24,}/g, "Google OAuth client secret"],
  [/(?:sk|rk)_live_[A-Za-z0-9]{20,}/g, "Stripe live key"],
  [/SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, "SendGrid API key"],
  [/hf_[A-Za-z0-9]{30,}/g, "Hugging Face token", keyLike],
  [/npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g, "npm token"],
  [/shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}(?![a-fA-F0-9])/g, "Shopify token"],
  [/ATATT3[A-Za-z0-9_=-]{50,}/g, "Atlassian API token"],
  [/\bAC[0-9a-f]{32}\b|\bSK[0-9a-f]{32}\b/g, "Twilio key"],
];
const DOC_EXAMPLE_KEYS = new Set(["AKIAIOSFODNN7EXAMPLE", "AKIAI44QH8DHBEXAMPLE"]);

const apiKeys: Detector = ({ n }) => {
  const out: Finding[] = [];
  for (const [re, name, check] of PROVIDER_KEYS) {
    out.push(...each(re, n, (m) => {
      if (check && !check(m[0])) return null;
      if (DOC_EXAMPLE_KEYS.has(m[0]) || /EXAMPLE|XXXXXXXX|0000000000/.test(m[0]))
        return f(1, "api_key", "allow", m.index, m.index + m[0].length, "Example key", "A documentation example, not a real key", "", 10);
      return f(1, "api_key", "block", m.index, m.index + m[0].length, name, `Matches the ${name} format`, "API_KEY", 10);
    }));
  }
  out.push(...each(/\b(?:sk|pk|rk)_test_[A-Za-z0-9]{16,}/g, n, (m) =>
    f(1, "api_key", "allow", m.index, m.index + m[0].length, "Stripe test key", "Test-mode keys cannot move money", "", 10)));
  out.push(...each(/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, n, (m) => {
    try {
      const head = JSON.parse(atob(m[0].split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
      if (!head || typeof head !== "object" || !("alg" in head)) return null;
    } catch { return null; }
    return f(1, "jwt", "block", m.index, m.index + m[0].length, "Access token (JWT)", "A signed token that can grant access", "TOKEN", 11);
  }));
  out.push(...each(/\b(?:Bearer|Token)\s+([A-Za-z0-9\-._~+/]{24,}=*)/g, n, (m) => {
    if (shannon(m[1]) < 3.5) return null;
    const s = m.index + m[0].length - m[1].length;
    return f(1, "bearer", "block", s, s + m[1].length, "Access token", "Value of an Authorization header", "TOKEN", 12);
  }));
  return out;
};

// ---------------------------------------------------------------- 2. Passwords, secrets, private keys
const PW_LABELS = "password|passwd|pwd|passphrase|passcode|pass|contraseña|contrasena|clave|mot de passe|mdp|passwort|kennwort|senha|wachtwoord|parola|hasło|haslo|пароль|密码|密碼|パスワード|비밀번호|पासवर्ड|पासवर्ड|كلمة المرور|كلمة السر|şifre|sifre|lösenord|adgangskode";
const PW_RE = new RegExp(
  `(?<![\\w-])(${PW_LABELS})(?![\\w-])(["'\\]]?)[ \\t]*(?:(?:is|es|ist|est|é|è|है|は|是|:|=|：|=>|->)[ \\t]*[:=：]?)[ \\t]*(["'\`]?)([^\\s"'\`,;)]{3,128})`,
  "giu",
);
const SECRET_RE = /(?<![\w-])((?:[A-Za-z]+[_-])*(?:api[_-]?key|apikey|secret|secret[_-]?key|client[_-]?secret|access[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|signing[_-]?key|encryption[_-]?key))(["']?)\s*(?::|=|:=|=>)\s*(["'`]?)([A-Za-z0-9_\-/+=.~]{12,})\3/gi;

/** True for values that read as code (a type, variable or call), not a literal secret. */
function looksLikeCodeReference(v: string, quoted: boolean): boolean {
  if (quoted) return false;
  if (/\d/.test(v) && /[^A-Za-z0-9_$.[\]()]/.test(v)) return false;
  return /^[A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\(.*|\[.*)?$/.test(v) && !/\d{2,}/.test(v);
}

const secrets: Detector = ({ n }) => {
  const out: Finding[] = [];
  out.push(...each(/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,8000}?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, n, (m) => {
    const body = m[0].replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    if (body.length < 32) return f(2, "private_key", "warn", m.index, m.index + m[0].length, "Private key header", "Looks like a private key, but the body is too short to be real", "PRIVATE_KEY", 5);
    return f(2, "private_key", "block", m.index, m.index + m[0].length, "Private key", "PEM private-key block", "PRIVATE_KEY", 5);
  }));
  out.push(...each(/PuTTY-User-Key-File-\d: [\s\S]{0,4000}?Private-Lines: \d+[\s\S]{40,}/g, n, (m) =>
    f(2, "private_key", "block", m.index, m.index + m[0].length, "Private key", "PuTTY private-key file", "PRIVATE_KEY", 5)));

  out.push(...each(PW_RE, n, (m) => {
    const label = m[1];
    const quoted = m[3] !== "";
    let v = m[4];
    if (!quoted) v = v.replace(/[.!?]+$/, (t) => (v.length - t.length >= 6 ? "" : t));
    const s = m.index + m[0].length - m[4].length;
    if (/^pass$/i.test(label) && !quoted && !/\d/.test(v)) return null; // "pass: true", "pass is fine"
    if (v.length < 4 || /^(?:[/~]|\.{1,2}\/|[A-Za-z]:\\)/.test(v)) return null; // too short to judge, or a path ("pwd: /Users/…")
    if (PLACEHOLDER.test(v) || /^[<{[$%]/.test(v)) return f(2, "password", "allow", s, s + v.length, "Password placeholder", "A placeholder, not a real value", "", 30);
    if (looksLikeCodeReference(v, quoted))
      return f(2, "password", "allow", s, s + v.length, "Password field in code", `"${v.slice(0, 30)}" is a type or variable, not a value`, "", 30);
    if (/^(?:true|false|required|optional|string|text|number|hidden|field|input|reset|policy|length|strength)$/i.test(v)) return null;
    return f(2, "password", "block", s, s + v.length, "Password", `A value is given after "${label}"`, "PASSWORD", 30);
  }));

  out.push(...each(SECRET_RE, n, (m) => {
    const v = m[4];
    const quoted = m[3] !== "";
    const s = m.index + m[0].length - v.length - m[3].length;
    if (PLACEHOLDER.test(v) || looksLikeCodeReference(v, quoted)) return null;
    if (shannon(v) < 3.2 || v.length < 16) return null;
    return f(2, "secret_assignment", "block", s, s + v.length, "Secret value", `A random-looking value assigned to "${m[1]}"`, "SECRET", 31);
  }));

  // Unlabelled passwords: random-looking tokens. Block only next to login details; otherwise warn.
  out.push(...each(/(^|[\s(:"'`,])([^\s"'`(),]{8,64})(?=$|[\s"'`),.;!?])/g, n, (m) => {
    let t = m[2].replace(/[.,;:!?)]+$/, (x) => (m[2].length - x.length >= 8 ? "" : x));
    const s = m.index + m[1].length;
    const classes = Number(/[a-z]/.test(t)) + Number(/[A-Z]/.test(t)) + Number(/\d/.test(t)) + Number(/[^A-Za-z0-9]/.test(t));
    if (classes < 3 || !/\d/.test(t)) return null;
    if (/[<>{}[\]()=;"'`:,\\|]|^[-*#/]|\*\*|\$\{|=>|\?\.|&&/.test(t)) return null; // code or markup, not a password
    if (/\$\d+$|\/|#L\d|^[A-Za-z]+\$?\d?$/.test(t)) return null; // bundler names (foo$1), paths, line anchors
    if (/[a-z]\.[A-Za-z]|^![A-Za-z_]/.test(t)) return null; // member access (e.chunkSize), negated identifiers
    if (/:\/\/|^www\.|^[./~\\]|[\w.+-]+@[\w-]+\.\w|^[0-9a-f-]{16,}$|^\d[\d\s,.:/-]*$|^v?\d+\.\d+|^#|^[A-Z]{2,}\d*$/i.test(t)) return null;
    if (/^[A-Za-z_$][\w$]*(?:[.:][\w$]+)+(?:\(\)?)?$/.test(t)) return null; // obj.prop, Foo::bar
    if (/^[A-Za-z]+[-_]?\d{1,4}$|^\d{1,4}[A-Za-z]+$/.test(t)) return null; // "Room-12", "2FA"
    if (shannon(t) < 2.9) return null;
    t = t.slice(0, 64);
    const ctxBefore = before(n, s, 60);
    const login = /(?:log ?in|sign ?in|creds?|credentials|user ?name|username|account password|wi-?fi|ssid|vpn|ssh)\b[^\n]{0,30}$|[\w.+-]+@[\w-]+\.[\w.]+\s*(?:\/|\||,|:)\s*$|\buser(?:name)?\s*[:=]\s*\S+\s*(?:\/|\||,)\s*$/i.test(ctxBefore);
    if (login) return f(2, "unlabelled_password", "block", s, s + t.length, "Password", "A random-looking string next to login details", "PASSWORD", 40);
    const sequential = /abcde|bcdef|cdefg|12345|23456|qwert|asdfg/i.test(t);
    if (classes === 4 && t.length >= 10 && /[!@#$%^&*?~+]/.test(t) && !sequential && shannon(t) >= 3.2)
      return f(2, "unlabelled_password", "warn", s, s + t.length, "Possible password", "A random-looking string with no label; check it is not a password", "PASSWORD", 40);
    return null;
  }));
  return out;
};

// ---------------------------------------------------------------- 3. Government IDs
const govIds: Detector = ({ n }) => {
  const out: Finding[] = [];
  out.push(...each(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, n, (m) =>
    f(3, "ssn", "block", m.index, m.index + m[0].length, "US Social Security number", "A valid SSN in the 123-45-6789 format", "SSN", 20)));
  out.push(...each(/\b(?!000|666|9\d\d)\d{3} ?(?!00)\d{2} ?(?!0000)\d{4}\b/g, n, (m) => {
    if (!/(ssn|social security|soc\.? sec)/i.test(before(n, m.index, 40))) return null;
    return f(3, "ssn", "block", m.index, m.index + m[0].length, "US Social Security number", "Labelled as a Social Security number", "SSN", 20);
  }));
  // Passport: label + number in any of the common formats
  out.push(...each(/(passport|pasaporte|passeport|reisepass|passaporto|passaporte|पासपोर्ट|护照|パスポート|여권|паспорт)(?:\s*(?:number|no\.?|num|nr\.?|#|número|numéro|nummer|संख्या|号码|番号))?[\s:#=.-]{0,6}((?:[A-Z]{1,3}\d{6,8})|(?:\d{8,9})|(?:[A-Z]\d{7}[A-Z]?))\b/giu, n, (m) => {
    const v = m[2];
    const s = m.index + m[0].length - v.length;
    return f(3, "passport", "block", s, s + v.length, "Passport number", `Labelled "${m[1]}"`, "PASSPORT", 21);
  }));
  // Machine-readable zone, second line of a passport
  out.push(...each(/\b([A-Z0-9<]{9})(\d)([A-Z<]{3})(\d{6})(\d)[MFX<](\d{6})(\d)/g, n, (m) => {
    if (!mrzCheck(m[1], m[2]) || !mrzCheck(m[4], m[5]) || !mrzCheck(m[6], m[7])) return null;
    return f(3, "passport_mrz", "block", m.index, m.index + m[0].length, "Passport machine-readable line", "All three MRZ check digits are valid", "PASSPORT", 21);
  }));
  // Driver licence: label required, formats differ by state and country
  out.push(...each(/(driver'?s?\s*licen[cs]e|driving licen[cs]e|licen[cs]e\s*(?:no|number|#)|\bDL\s*(?:no|number|#)?|führerschein|permis de conduire|licencia de conducir|ड्राइविंग लाइसेंस)(?:\s*(?:number|no\.?|num|nr\.?|#|número|numéro|nummer|संख्या|号码|番号))?[\s:#=.-]{0,6}([A-Z]{0,3}\d[A-Z0-9-]{4,15})\b/giu, n, (m) => {
    const v = m[2];
    const s = m.index + m[0].length - v.length;
    return f(3, "driver_licence", "block", s, s + v.length, "Driver licence number", `Labelled "${m[1].trim()}"`, "DRIVER_LICENCE", 22);
  }));
  // National IDs by label (NI number, SIN, NRIC, etc.)
  out.push(...each(/(national id(?:entity)?(?: number| no\.?)?|national insurance(?: number| no\.?)?|\bNINO\b|\bNRIC\b|\bSIN\b|\bCURP\b|\bDNI\b|\bNIE\b|codice fiscale|personnummer|\bBSN\b|\bHKID\b|\bMyKad\b)(?:\s*(?:number|no\.?|num|nr\.?|#|número|numéro|nummer|संख्या|号码|番号))?[\s:#=.-]{0,6}([A-Z]{0,3}\d[A-Z0-9 -]{5,18}[A-Z0-9])\b/gi, n, (m) => {
    const v = m[2];
    const s = m.index + m[0].length - v.length;
    return f(3, "national_id", "block", s, s + v.length, "National ID number", `Labelled "${m[1]}"`, "NATIONAL_ID", 23);
  }));
  // Medicare (Australia): check digit + label
  out.push(...each(/(?<!\d[ -]?)[2-6]\d{3}[ -]?\d{5}[ -]?\d(?:[ /-]?\d)?(?![ -]?\d)/g, n, (m) => {
    if (!medicare(digitsOf(m[0]))) return null;
    const key = (jsonKeyBefore(n, m.index) ?? "") + " " + (csvColumnAt(n, m.index) ?? "");
    if (!/(medicare|मेडिकेयर)/i.test(before(n, m.index, 50)) && !/medicare/i.test(key)) return null;
    return f(3, "medicare", "block", m.index, m.index + m[0].length, "Medicare number", "Check digit is valid and it is labelled Medicare", "MEDICARE", 24);
  }));
  return out;
};

// ---------------------------------------------------------------- 4. Tax File Numbers
const REF_LABEL = /(order|invoice|inv|ref(?:erence)?|tracking|consignment|booking|ticket|case|incident|po|purchase order|sku|item|product|serial|receipt|transaction|txn|confirmation|account no for|phone|mobile|tel|fax|abn|acn)\s*(?:#|no\.?|number|num|id)?\s*[:=]?\s*#?\s*$/i;
const TFN_LABEL = /(tfn|tax ?file|tax no|tax number|टैक्स|कर फ़ाइल|税号|納税者番号|numéro fiscal|steuer)/i;

const tfns: Detector = ({ n }) => each(/(?<!\d[ -]?)(?<!-)\d{3}[ -]?\d{3}[ -]?\d{2,3}(?![ -]?\d)(?!-)/g, n, (m) => {
  const d = digitsOf(m[0]);
  if (!tfn(d)) return null;
  const b = before(n, m.index, 50);
  const key = (jsonKeyBefore(n, m.index) ?? "") + " " + (csvColumnAt(n, m.index) ?? "");
  const labelled = TFN_LABEL.test(b) || /tfn|tax/.test(key);
  const grouped = /^\d{3}[ -]\d{3}[ -]\d{3}$/.test(m[0]);
  if (!labelled && (REF_LABEL.test(b) || /order|invoice|ref|id$|phone/.test(key)))
    return f(4, "tfn", "warn", m.index, m.index + m[0].length, "Possible tax file number", "Passes the TFN checksum but is labelled as a reference number, so it only needs a confirmation", "TFN", 50);
  if (labelled || grouped)
    return f(4, "tfn", "block", m.index, m.index + m[0].length, "Tax file number", `Passes the TFN checksum${labelled ? " and is labelled as a TFN" : " and is written in TFN grouping (3-3-3)"}`, "TFN", 50);
  // About 1 in 11 random numbers pass the checksum, so an unlabelled, ungrouped number needs tax context to count.
  if (d.length !== 9 || !/(tax|\bato\b|payroll|superannuation|employee|salary|payslip)/i.test(before(n, m.index, 120) + after(n, m.index, 60))) return null;
  return f(4, "tfn", "warn", m.index, m.index + m[0].length, "Possible tax file number", "Passes the TFN checksum near tax or payroll words, but has no TFN label", "TFN", 50);
});

// ---------------------------------------------------------------- 5. Cards and bank accounts
const TEST_CARDS = new Set([
  "4242424242424242", "4000056655665556", "4111111111111111", "4012888888881881", "4000000000000002",
  "4000000000009995", "5555555555554444", "5200828282828210", "5105105105105100", "2223003122003222",
  "378282246310005", "371449635398431", "378734493671000", "6011111111111117", "6011000990139424",
  "3056930009020004", "36227206271667", "3566002020360505", "6200000000000005", "4000000000000077",
  "4000002500003155", "4000000000003220", "5454545454545454", "4444333322221111", "4917610000000000",
]);
const CARD_BRANDS: Array<[RegExp, string]> = [
  [/^4/, "Visa"], [/^(5[1-5]|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/, "Mastercard"], [/^3[47]/, "American Express"],
  [/^(6011|65|64[4-9]|622)/, "Discover/UnionPay"], [/^35(2[89]|[3-8]\d)/, "JCB"], [/^3(0[0-5]|[68])/, "Diners Club"], [/^62/, "UnionPay"],
];

const finance: Detector = ({ n }) => {
  const out: Finding[] = [];
  out.push(...each(/(?<!\d[ -]?)\d(?:[ -]?\d){12,18}(?![ -]?\d)/g, n, (m) => {
    const d = digitsOf(m[0]);
    const k = d.join("");
    if (/order|invoice|ref|tracking|sku|id$/.test(csvColumnAt(n, m.index) ?? "")) return null;
    if (TEST_CARDS.has(k)) return f(5, "card", "allow", m.index, m.index + m[0].length, "Test card number", "A published payment test card", "", 15);
    if (!luhn(d) || /^(\d)\1+$/.test(k)) return null;
    const brand = CARD_BRANDS.find(([re]) => re.test(k));
    if (!brand) return null;
    if (d.length === 13 && brand[1] !== "Visa") return null;
    return f(5, "card", "block", m.index, m.index + m[0].length, "Payment card number", `${brand[1]} number that passes the Luhn check`, "CARD", 15);
  }));
  out.push(...each(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, n, (m) => {
    if (!iban(m[0])) return null;
    return f(5, "iban", "block", m.index, m.index + m[0].length, "Bank account (IBAN)", "Passes the IBAN mod-97 check", "BANK_ACCOUNT", 16);
  }));
  // BSB + account number, with a banking label nearby
  out.push(...each(/\b(\d{3})[- ]?(\d{3})[ ,/|-]{1,5}(?:(?:acc(?:oun)?t|a\/c|acct)\s*(?:no\.?|number|#)?\s*[:#]?\s*)?(\d{6,10})\b/gi, n, (m) => {
    const ctx = before(n, m.index, 40) + m[0];
    if (!/(bsb|bank|acc(?:oun)?t|a\/c|acct)/i.test(ctx)) return null;
    return f(5, "bsb_account", "block", m.index, m.index + m[0].length, "Bank account (BSB and account number)", "BSB and account number with a banking label", "BANK_ACCOUNT", 17);
  }));
  out.push(...each(/((?:bank\s*)?acc(?:oun)?t(?:\s*(?:no\.?|number|#))|a\/c(?:\s*no\.?)?|account number|routing number|sort code|IFSC|clabe|número de cuenta|numéro de compte|kontonummer|खाता संख्या)(?:\s*(?:number|no\.?|num|nr\.?|#|número|numéro|nummer|संख्या|号码|番号))?[\s:#=.-]{0,6}([A-Z]{0,4}\d[\d -]{5,20}\d)\b/giu, n, (m) => {
    const v = m[2];
    const s = m.index + m[0].length - v.length;
    if (digitsOf(v).length < 6) return null;
    return f(5, "bank_account", "block", s, s + v.length, "Bank account number", `Labelled "${m[1].trim()}"`, "BANK_ACCOUNT", 18);
  }));
  return out;
};

// ---------------------------------------------------------------- 6. ABN or PAN next to a name, Aadhaar
const indiaAndAbn: Detector = ({ n }) => {
  const out: Finding[] = [];
  out.push(...each(/(?<!\d[ -]?)\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}(?![ -]?\d)/g, n, (m) => {
    if (!abn(digitsOf(m[0]))) return null;
    const line = lineAround(n, m.index, m.index + m[0].length);
    const who = personName(line);
    if (who && !COMPANY.test(line))
      return f(6, "abn", "block", m.index, m.index + m[0].length, "ABN next to a person's name", `Passes the ABN check and appears beside "${who}"`, "ABN", 25);
    return f(6, "abn", "allow", m.index, m.index + m[0].length, "ABN", "A valid ABN with no person named beside it; business ABNs are public", "", 25);
  }));
  out.push(...each(/\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g, n, (m) => {
    const line = lineAround(n, m.index, m.index + m[0].length);
    const near = before(n, m.index, 120) + " " + after(n, m.index + m[0].length, 60);
    const who = personName(line) ?? personName(near);
    const labelled = /\bPAN\b|permanent account/i.test(before(n, m.index, 40));
    if (!who && !labelled) return f(6, "pan", "warn", m.index, m.index + m[0].length, "PAN (India)", "PAN format with no name nearby", "PAN", 26);
    if (!who) return f(6, "pan", "warn", m.index, m.index + m[0].length, "PAN (India)", "Labelled PAN, but no name nearby", "PAN", 26);
    const surname = who.split(/\s+/).pop() ?? "";
    const strong = m[0][3] === "P" && surname[0] === m[0][4];
    return f(6, "pan", "block", m.index, m.index + m[0].length, "PAN next to a name", `Beside "${who}"${strong ? "; its fifth letter matches the surname initial" : ""}`, "PAN", 26);
  }));
  out.push(...each(/(?<!\d[ -]?)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![ -]?\d)/g, n, (m) => {
    if (!verhoeff(digitsOf(m[0]))) return null;
    const rec = before(n, m.index, 200);
    const labelled = /(aadhaar|aadhar|adhaar|आधार|\buid\b|uidai)/i.test(rec + " " + (csvColumnAt(n, m.index) ?? ""));
    const grouped = /^\d{4}[ -]\d{4}[ -]\d{4}$/.test(m[0]);
    if (!labelled && REF_LABEL.test(before(n, m.index, 40)))
      return f(6, "aadhaar", "warn", m.index, m.index + m[0].length, "Possible Aadhaar number", "Passes the Verhoeff check but is labelled as a reference", "AADHAAR", 27);
    if (labelled || grouped)
      return f(6, "aadhaar", "block", m.index, m.index + m[0].length, "Aadhaar number", `Passes the Verhoeff check${labelled ? " and is labelled Aadhaar" : " and uses Aadhaar grouping (4-4-4)"}`, "AADHAAR", 27);
    return f(6, "aadhaar", "warn", m.index, m.index + m[0].length, "Possible Aadhaar number", "Passes the Verhoeff check but has no label", "AADHAAR", 27);
  }));
  return out;
};

// ---------------------------------------------------------------- 7. Database credentials and connection strings
const databases: Detector = ({ n }) => {
  const out: Finding[] = [];
  out.push(...each(/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|oracle|cockroachdb|clickhouse|snowflake|jdbc:[a-z]+|neo4j(?:\+s)?|bolt):\/\/([^\s:@/'"]+):([^\s@/'"]+)@[^\s'"`<>]+/gi, n, (m) => {
    if (PLACEHOLDER.test(m[2]) || /^\*+$|^\$/.test(m[2]))
      return f(7, "connection_string", "allow", m.index, m.index + m[0].length, "Connection string", "The password is a placeholder", "", 8);
    return f(7, "connection_string", "block", m.index, m.index + m[0].length, "Database connection string", "Contains a username and a literal password", "DB_CONNECTION", 8);
  }));
  out.push(...each(/(?:Server|Data Source|Host|Address)\s*=[^;\n]+;[^\n]*?(?:Password|Pwd)\s*=\s*([^;\n"']+)/gi, n, (m) => {
    if (PLACEHOLDER.test(m[1].trim())) return null;
    return f(7, "connection_string", "block", m.index, m.index + m[0].length, "Database connection string", "ADO.NET connection string with a password", "DB_CONNECTION", 8);
  }));
  out.push(...each(/jdbc:[a-z]+:[^\s"']*?[;?&](?:password|pwd)=([^;&\s"']+)/gi, n, (m) => {
    if (PLACEHOLDER.test(m[1])) return null;
    return f(7, "connection_string", "block", m.index, m.index + m[0].length, "Database connection string", "JDBC URL with a password", "DB_CONNECTION", 8);
  }));
  out.push(...each(/DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=([A-Za-z0-9+/=]{40,})/g, n, (m) =>
    f(7, "connection_string", "block", m.index, m.index + m[0].length, "Azure storage connection string", "Contains a storage account key", "DB_CONNECTION", 8)));
  out.push(...each(/\b((?:DB|DATABASE|PG|MYSQL|MONGO|REDIS|POSTGRES)_?(?:PASS(?:WORD)?|PWD))\s*[:=]\s*(["']?)([^\s"']{4,})\2/g, n, (m) => {
    if (PLACEHOLDER.test(m[3]) || looksLikeCodeReference(m[3], m[2] !== "")) return null;
    const s = m.index + m[0].length - m[3].length - m[2].length;
    return f(7, "db_password", "block", s, s + m[3].length, "Database password", `Value assigned to ${m[1]}`, "DB_PASSWORD", 9);
  }));
  return out;
};

// ---------------------------------------------------------------- 8–10. Context categories, one record at a time
const ID_MARKER = /\b(?:patient|name|full name|dob|d\.o\.b|date of birth|born|mrn|urn|medicare|ihi|nhs number|hospital no|customer|client|account holder|member|email|e-mail|phone|mobile|address)\b\s*(?:no\.?|number|#|id)?\s*[:=#-]/i;
const MEDICAL_ABBR = /\b(?:Dx|DX|MRI|HIV|ICD-10|CT scan)\b|(?<![\w.])[A-TV-Z]\d{2}\.\d{1,2}\b/;
const MEDICAL = /\b(?:diagnos(?:is|ed|es)|prognosis|prescri(?:bed|ption)|medication|dosage|\d+(?:\.\d+)?\s?(?:mg|mcg|ml|units?)\b|discharge summary|admitted|admission|patholog(?:y|ist)|biopsy|oncology|chemotherapy|hepatitis|schizophrenia|bipolar|depression|anxiety disorder|diabetes|asthma|cancer|tumou?r|pregnan(?:t|cy)|allerg(?:y|ies)|blood test|x-ray|surgery|treatment plan|clinical notes?|referral)\b/i;
const FINANCIAL = /\b(?:balance|credit limit|available credit|arrears|overdue|outstanding|loan amount|loan balance|repayment|mortgage|salary|income|net worth|credit score|transactions?|withdrawal|deposit|debt|bsb|iban|account no)\b/i;
const MONEY = /(?:[$€£₹¥]|\b(?:AUD|USD|INR|EUR|GBP)\s?)\d[\d,]*(?:\.\d{2})?/;
const NAME_COL = /^(?:name|full[ _]?name|first[ _]?name|last[ _]?name|surname|customer(?:[ _]?name)?|client(?:[ _]?name)?|patient(?:[ _]?name)?|email|e-mail|account[ _]?holder|member)$/;
const FIN_COL = /balance|amount|limit|arrears|overdue|outstanding|loan|salary|income|credit|debt|payment/;
const MED_COL = /diagnos|condition|medication|dx|icd|treatment|allerg|procedure/;
const CONFIDENTIAL = /\b(?:CONFIDENTIAL|STRICTLY CONFIDENTIAL|INTERNAL USE ONLY|INTERNAL ONLY|PROPRIETARY|TRADE SECRET|DO NOT DISTRIBUTE|NOT FOR DISTRIBUTION|COMPANY CONFIDENTIAL|Confidential and Proprietary|Proprietary and Confidential)\b/;

const records810: Detector = ({ n, policy }) => {
  const out: Finding[] = [];
  for (const rec of records(n)) {
    const t = rec.text;
    const header = csvHeader(t);
    // CSV: header columns decide the whole table
    if (header) {
      const hasName = header.some((h) => NAME_COL.test(h));
      const fin = header.find((h) => FIN_COL.test(h));
      const med = header.find((h) => MED_COL.test(h));
      const hdrEnd = rec.start + t.indexOf("\n");
      if (hasName && fin) out.push(f(8, "financial_record", "block", rec.start, hdrEnd, "Customer financial records", `A table with named customers and a "${fin}" column`, "", 60));
      if (hasName && med) out.push(f(9, "medical_record", "block", rec.start, hdrEnd, "Medical records", `A table with named people and a "${med}" column`, "", 60));
      if ((hasName && fin) || (hasName && med)) continue;
    }
    const idm = t.match(ID_MARKER);
    const who = personName(t);
    const med = t.match(MEDICAL) ?? t.match(MEDICAL_ABBR);
    const strongId = /\b(?:patient|dob|d\.o\.b|date of birth|mrn|urn|medicare|ihi|nhs number|hospital no)\b\s*(?:no\.?|number|#|id)?\s*[:=#-]/i.test(t);
    if (med && (strongId || (idm && who))) {
      const s = rec.start + (med.index ?? 0);
      out.push(f(9, "medical_record", "block", s, s + med[0].length, "Medical record", `Health details in the same record as ${who ? `"${who}"` : "a patient identifier"}`, "", 61));
    }
    const fin = t.match(FINANCIAL);
    const custLabel = /\b(?:customer|client|account holder|member|borrower|cardholder)\b\s*(?:name)?\s*[:=-]/i.test(t);
    if (fin && custLabel && who && (MONEY.test(t) || /\b(?:bsb|iban|account no)\b/i.test(t))) {
      const s = rec.start + (fin.index ?? 0);
      out.push(f(8, "financial_record", "block", s, s + fin[0].length, "Customer financial record", `Financial details in the same record as "${who}"`, "", 62));
    }
    const conf = t.match(CONFIDENTIAL);
    if (conf) {
      const s = rec.start + (conf.index ?? 0);
      out.push(f(10, "confidential_marker", "block", s, s + conf[0].length, "Confidential material", `Marked "${conf[0]}"`, "", 63));
    }
    for (const word of [...policy.confidentialMarkers, ...policy.orgFingerprints]) {
      if (!word) continue;
      const i = t.toLowerCase().indexOf(word.toLowerCase());
      if (i >= 0) out.push(f(10, "org_fingerprint", "block", rec.start + i, rec.start + i + word.length, "Internal or proprietary material", `Contains "${word}", which your organisation marks as internal`, "", 63));
    }
    // Large unmarked code: warn only, because sharing code with AI tools is a normal, legitimate use
    const codeLines = t.split("\n").filter((l) => /[;{}()]\s*$|^\s*(?:def|class|function|import|from|const|let|var|public|private|package|#include)\b/.test(l)).length;
    if (codeLines >= 150) out.push(f(10, "large_code", "warn", rec.start, rec.start + Math.min(t.length, 40), "Large code paste", `${codeLines} lines of code; make sure it is not proprietary`, "", 64));
  }
  return out;
};

export const DETECTORS: Detector[] = [apiKeys, secrets, govIds, tfns, finance, indiaAndAbn, databases, records810];

