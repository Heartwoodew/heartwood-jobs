import { chromium } from "playwright-core";
import { open } from "./.dryrun-login.mjs";
const { b, p, errs } = await open();
const re = /Heartwood|heartwoodew|Orbit|Patrick|Nicole|alex@/gi;
const views = ["home","chat","clients","staff","dispatch","jobs","unscheduled","quotes","completed","invoices","reimb","timesheet","leave","safety","swms","prestart","compliance","settings"];
for (const v of views) {
  const btn = p.locator(`.sm-nav[data-view="${v}"]`).first();
  if (!(await btn.count())) { console.log(v, "no nav"); continue; }
  await btn.click({ force: true }).catch(() => {}); await p.waitForTimeout(1800);
  const t = await p.evaluate(() => { const a = document.querySelector("#app").cloneNode(true); a.querySelectorAll("nav, .sm-nav, .sm-side, aside").forEach(n => n.remove()); return a.innerText; }).catch(() => "");
  const hits = [...new Set((t.match(re) || []))];
  const hasPo = /Find PO|Import from inbox|builder inbox/i.test(t);
  console.log(v.padEnd(12), "hits:", JSON.stringify(hits), hasPo ? "PO/INBOX VISIBLE" : "", "|", t.replace(/\s+/g, " ").slice(0, 160));
}
console.log("errors:", JSON.stringify([...new Set(errs)].slice(0, 10)));
await b.close();
