// Minimal stand-in for a chat app, shared by the fixture pages. It behaves like the real sites in the
// ways that matter here: a contenteditable composer, a send button, Enter to send, large pastes turned
// into chips whose full text is NOT in the DOM, and a fetch to the chat endpoint on send.
window.__sent = [];
window.__errors = [];
const cfg = window.FIXTURE;
const editor = document.querySelector(cfg.editor);
const chipsBox = document.querySelector("#chips");
const attachments = [];

function send() {
  const text = editor.innerText.trim();
  if (!text && !attachments.length) return;
  const body = cfg.body(text, attachments.map((a) => a.text));
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  fetch(cfg.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: payload })
    .then(() => window.__sent.push({ text, attachments: attachments.map((a) => a.text) }))
    .catch((e) => window.__errors.push(String(e)));
  editor.innerHTML = "<p><br></p>";
  attachments.length = 0;
  chipsBox.innerHTML = "";
  sync();
}
window.__bypassSend = (text) =>
  fetch(cfg.endpoint, { method: "POST", body: (b => typeof b === "string" ? b : JSON.stringify(b))(cfg.body(text, [])) })
    .then(() => window.__sent.push({ text, bypass: true }))
    .catch((e) => window.__errors.push(String(e)));

function sync() {
  const btn = document.querySelector(cfg.send);
  if (cfg.hideSendWhenEmpty && btn) btn.hidden = !editor.innerText.trim() && !attachments.length;
}

editor.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (cfg.form) document.querySelector("form").requestSubmit();
    else send();
  }
});
editor.addEventListener("input", sync);
editor.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  if (text.length > cfg.chipAt) {
    const chip = document.createElement("div");
    if (cfg.chipTestId) chip.dataset.testid = cfg.chipTestId;
    chip.className = "chip";
    const entry = { text };
    attachments.push(entry);
    chip.innerHTML = `<div class="preview"></div><div class="kind">PASTED</div><button type="button" aria-label="${cfg.removeLabel}">×</button>`;
    chip.querySelector(".preview").textContent = text.slice(0, cfg.previewChars) + "…";
    chip.querySelector("button").addEventListener("click", () => {
      attachments.splice(attachments.indexOf(entry), 1);
      chip.remove();
      sync();
    });
    chipsBox.appendChild(chip);
  } else {
    document.execCommand("insertText", false, text);
  }
  sync();
});
if (cfg.form) document.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); send(); });
// Like React, the app handles clicks at the document root (bubble phase).
document.addEventListener("click", (e) => { if (!cfg.form && e.target.closest(cfg.send)) send(); });
sync();
