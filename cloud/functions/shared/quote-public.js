// Customer quote link. The token is unguessable. The public page is read-only.
// Accept records the name, time, IP and browser. There is no decline and no deposit.
// Turning that acceptance into a job stays a separate one-tap action for the office.
// The dollar amounts on that job are written to job money, which crew cannot read.
//
// Customer signature sign-off is not on this page. A later signature would be its
// own step after Accept, stored with the job documents, not in this token.

export const PUBLIC_QUOTE_ORIGIN = "https://app.callupapp.com.au";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function newPublicToken(source) {
  const bytes = source || new Uint8Array(32);
  if (!source) {
    if (!globalThis.crypto || !globalThis.crypto.getRandomValues) throw new Error("no-crypto");
    globalThis.crypto.getRandomValues(bytes);
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = (typeof Buffer !== "undefined" ? Buffer.from(bytes).toString("base64") : btoa(binary));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function tokenOk(token) {
  return /^[A-Za-z0-9_-]{32,80}$/.test(String(token || ""));
}

export function publicQuoteUrl(origin, token) {
  const base = String(origin || PUBLIC_QUOTE_ORIGIN).replace(/\/$/, "");
  return `${base}/q/${token}`;
}

export function canSendQuote(role) {
  return role === "admin";
}

const BOOTSTRAP_ADMINS = new Set(["1JKLsoxkQNfkphBBO0vDz2ziEyj2", "38SU5waAy4f9UI9N6JTqDMaYpQg2", "R7t41e54Ykcdk9WPdVZnDd697iI2"]);

export function callerIsAdmin(uid, profile, companyId) {
  if (BOOTSTRAP_ADMINS.has(uid) && companyId === "heartwood") return true;
  if (!profile || profile.role !== "admin") return false;
  const id = profile.companyId || profile.tenantId || (profile.role ? "heartwood" : "");
  return id === companyId;
}

export function allowPrefixes(env = {}) {
  return String(env.INVITE_EMAIL_ALLOW_TO || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

/** Live mail stays off unless the app is explicitly enabled. Tests pass callup932+ or a mock sender. */
export function quoteMailGate(to, env = {}, { allowLiveMail = false } = {}) {
  const addr = String(to || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(addr) || addr.length > 120) return { ok: false, reason: "email" };
  const enabled = env.INVITE_EMAIL_ENABLED === "true" && allowLiveMail === true;
  if (!enabled) return { ok: true, held: true, to: addr };
  const allow = allowPrefixes(env);
  if (allow.length && !allow.some(prefix => addr.startsWith(prefix))) return { ok: false, reason: "allow-list" };
  return { ok: true, held: false, to: addr };
}

export function quoteFromAddress(companyName) {
  const name = String(companyName || "CallUp").replace(/[<>]/g, "").trim().slice(0, 60) || "CallUp";
  return `${name} via CallUp <noreply@callupapp.com.au>`;
}

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return "$" + Number(n).toFixed(2);
}

export function publicLines(quote) {
  const src = Array.isArray(quote && quote.lines) ? quote.lines : [];
  return src.slice(0, 80).map(line => {
    const label = String((line && (line.label || line.name || line.description)) || "Item").slice(0, 160);
    const amount = line && line.amount != null && Number.isFinite(Number(line.amount)) ? Number(line.amount) : null;
    return { label, amount };
  }).filter(line => line.label);
}

export function quoteEmailText({ company, quote, link }) {
  const who = (company && (company.name || company.legalName)) || "CallUp";
  const lines = publicLines(quote).map(line => `- ${line.label}${line.amount != null ? `: ${money(line.amount)} ex GST` : ""}`);
  return [
    `${who} sent you a quote.`,
    "",
    quote && quote.client ? `Client: ${quote.client}` : "",
    quote && quote.address ? `Site: ${quote.address}` : "",
    quote && quote.description ? `Scope: ${quote.description}` : "",
    lines.length ? "" : "",
    ...lines,
    "",
    quote && quote.totalEx != null ? `Subtotal ex GST: ${money(quote.totalEx)}` : "",
    quote && quote.gst != null ? `GST: ${money(quote.gst)}` : "",
    quote && quote.totalInc != null ? `Total inc GST: ${money(quote.totalInc)}` : "",
    "",
    `Open the quote: ${link}`,
    "",
    "You can accept it on that page. There is no deposit to pay here.",
  ].filter(line => line !== "").join("\n");
}

export function planQuoteEmail({ company, quote, to, token, origin, env, allowLiveMail }) {
  if (!tokenOk(token)) return { ok: false, reason: "token" };
  const gate = quoteMailGate(to, env, { allowLiveMail });
  if (!gate.ok) return gate;
  const link = publicQuoteUrl(origin, token);
  const name = (company && company.name) || "CallUp";
  const message = {
    from: quoteFromAddress(name),
    to: gate.to,
    replyTo: company && company.email ? String(company.email).slice(0, 120) : "",
    subject: `Quote from ${name}`.slice(0, 120),
    text: quoteEmailText({ company, quote, link }),
    link,
  };
  return { ok: true, held: gate.held === true, message, link };
}

export function clientIp(headers = {}, fallback = "") {
  const fwd = String(headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "").split(",")[0].trim();
  const raw = fwd || String(fallback || "");
  return raw.replace(/[^0-9a-fA-F:.]/g, "").slice(0, 64);
}

export function acceptCustomerQuote({ quote, name, ip, userAgent, now }) {
  if (!quote || typeof quote !== "object") return { ok: false, reason: "missing" };
  if (quote.customerAccepted && quote.customerAccepted.name) {
    return { ok: true, already: true, customerAccepted: quote.customerAccepted };
  }
  const clean = String(name || "").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 80 || /[\n\r\t<>]/.test(clean)) return { ok: false, reason: "name" };
  const at = now || new Date().toISOString();
  return {
    ok: true,
    already: false,
    customerAccepted: {
      name: clean,
      acceptedAt: at,
      ip: String(ip || "").slice(0, 64),
      userAgent: String(userAgent || "").replace(/[\n\r]/g, " ").slice(0, 300),
    },
  };
}

function brandBlock(company) {
  const name = (company && (company.legalName || company.name)) || "Quote";
  const bits = [company && company.abn ? `ABN ${company.abn}` : "", company && company.phone || "", company && company.email || ""].filter(Boolean);
  const logo = company && /^https:\/\//.test(String(company.logoUrl || ""))
    ? `<img class="logo" alt="" src="${esc(company.logoUrl)}">` : "";
  return `${logo}<h1>${esc(name)}</h1>${bits.length ? `<p class="org">${esc(bits.join(" · "))}</p>` : ""}`;
}

export function publicQuoteHtml({ company, quote, accepted, token }) {
  const lines = publicLines(quote);
  const rows = lines.map(line => `<tr><td>${esc(line.label)}</td><td class="r">${line.amount != null ? esc(money(line.amount)) : ""}</td></tr>`).join("");
  const totals = quote && quote.totalEx != null
    ? `<tr><td class="r">Subtotal ex GST</td><td class="r">${esc(money(quote.totalEx))}</td></tr>
       <tr><td class="r">GST</td><td class="r">${esc(money(quote.gst))}</td></tr>
       <tr class="t"><td class="r">Total inc GST</td><td class="r">${esc(money(quote.totalInc))}</td></tr>`
    : `<tr><td colspan="2">This quote is not ready to price yet.</td></tr>`;
  const done = accepted && accepted.name;
  const form = done
    ? `<p class="ok">Accepted by ${esc(accepted.name)}.</p>`
    : `<form method="post" action="/q/${esc(token)}"><label>Your name<input name="name" required maxlength="80" autocomplete="name"></label>
        <button type="submit">Accept</button><p class="n">Accepting records your name and the time. There is no decline and no deposit.</p></form>`;
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quote</title>
<style>body{font:16px/1.45 system-ui,sans-serif;color:#1d1a16;max-width:640px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0}.org,.n{color:#5c4e42}.logo{max-height:48px;display:block;margin-bottom:8px}table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:8px 4px;border-bottom:1px solid #e4dbd0;vertical-align:top}.r{text-align:right;white-space:nowrap}tr.t td{font-weight:800;border-top:2px solid #1d1a16}button,input{font:inherit}input{display:block;width:100%;padding:8px;margin:6px 0 12px}button{background:#8a5a2b;color:#fff;border:0;border-radius:10px;padding:12px 16px;font-weight:700}.ok{background:#e7f5ea;padding:12px;border-radius:10px}</style></head><body>
${brandBlock(company)}
<p><b>${esc(quote && quote.client || "")}</b><br>${esc(quote && quote.address || "")}</p>
${quote && quote.description ? `<p>${esc(quote.description)}</p>` : ""}
<table><tbody>${rows}</tbody><tfoot>${totals}</tfoot></table>
${form}
</body></html>`;
}

export function sendQuoteButtonHtml(quoteId) {
  return `<button type="button" class="sm-btn" data-qsend="${esc(quoteId)}">Send quote</button>`;
}

export function customerAcceptedNote(quote) {
  const row = quote && quote.customerAccepted;
  if (!row || !row.name) return "";
  return `<div class="sub">Customer accepted by ${esc(row.name)}${row.acceptedAt ? ` · ${esc(String(row.acceptedAt).slice(0, 16))}` : ""}. Convert to a job when you are ready.</div>`;
}
