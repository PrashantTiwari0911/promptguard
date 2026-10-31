// Network backstop, running in the page's own JavaScript world. If a prompt reaches the network by a
// route the UI listeners did not see (a new button, a retry, "edit and resend"), the request body is
// scanned here and stopped when it holds a block-tier finding.
import { mask, scan } from "../engine/scan";

const CHAT_ENDPOINT = /\/(?:completion|append_message|retry_message)\b|\/backend-(?:api|anon)\/(?:f\/)?conversation\b|StreamGenerate|\/assistant\.lamda\./i;
const TEXT_KEYS = /^(?:prompt|content|contents|text|parts|extracted_content|message|messages|query|input|attachments)$/i;

/** Pulls the user-written text out of a request body, without the app's own ids and metadata. */
export function userText(body: string): string {
  const out: string[] = [];
  const walk = (v: unknown, inText: boolean): void => {
    if (typeof v === "string") {
      if (inText) out.push(v);
      else if (/^[\[{]/.test(v.trim())) { try { walk(JSON.parse(v), inText); } catch { /* not JSON */ } }
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, inText));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, inText || TEXT_KEYS.test(k));
  };
  try {
    walk(JSON.parse(body), false);
    return out.join("\n");
  } catch { /* not JSON */ }
  const params = new URLSearchParams(body);
  const freq = params.get("f.req"); // Gemini sends form-encoded nested JSON with no keys
  if (freq) {
    const strings: string[] = [];
    const all = (v: unknown): void => {
      if (typeof v === "string") { if (/^[\[{]/.test(v.trim())) { try { all(JSON.parse(v)); return; } catch { /* plain */ } } strings.push(v); }
      else if (Array.isArray(v)) v.forEach(all);
    };
    try { all(JSON.parse(freq)); } catch { /* ignore */ }
    return strings.join("\n");
  }
  return "";
}

function check(url: string, body: unknown): string | null {
  if (typeof body !== "string" || !CHAT_ENDPOINT.test(url)) return null;
  const text = userText(body);
  if (!text) return null;
  const r = scan(text);
  if (r.tier !== "block") return null;
  const items = r.findings.filter((f) => f.tier === "block").map((f) => ({ what: f.label ? `${f.what} ${mask(text.slice(f.start, f.end))}` : f.what, why: f.why }));
  window.dispatchEvent(new CustomEvent("promptguard:backstop", { detail: JSON.stringify(items) }));
  return items.map((i) => i.what).join(", ");
}

const realFetch = window.fetch;
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method === "POST" && CHAT_ENDPOINT.test(url)) {
    let body: unknown = init?.body;
    if (body === undefined && input instanceof Request) body = await input.clone().text();
    const hit = check(url, body);
    if (hit) throw new TypeError(`PromptGuard stopped this request: ${hit}`);
  }
  return realFetch.call(this, input, init);
};

const proto = XMLHttpRequest.prototype;
const realOpen = proto.open;
const realSend = proto.send;
const urls = new WeakMap<XMLHttpRequest, string>();
proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  urls.set(this, `${method.toUpperCase()} ${String(url)}`);
  return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
} as typeof proto.open;
proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
  const target = urls.get(this) ?? "";
  if (target.startsWith("POST ") && check(target.slice(5), body)) {
    window.setTimeout(() => this.dispatchEvent(new ProgressEvent("error")), 0);
    return;
  }
  return realSend.call(this, body);
};
