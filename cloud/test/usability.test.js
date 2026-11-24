import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildClientCreate } from "../../app/features/company.js";
import { clientFormHtml, signupFieldErrors, signupFormHtml } from "../../app/features/company-ui.js";
import { prestartEmptyHtml } from "../../app/features/compliance.js";
import { messagesHtml } from "../../app/features/chat.js";
import { askHelp, helpVisible, matchHelp, replyShowsMoney, teamChatHelpCard } from "../../app/features/help.js";
import { emailSheetHtml } from "../../app/features/job-email.js";
import { normalizeQuoteSections, ratesNeededHtml, startingQuoteTrade } from "../../app/features/quotes.js";
import { take5EntryVisible, take5StartButtonHtml } from "../../app/features/take5.js";
import { defaultJobCategory, jobCategoryGroups, jobCategorySelectHtml } from "../../app/features/trades.js";

const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
const quotes = readFileSync(new URL("../../app/features/quotes.js", import.meta.url), "utf8");
const compliance = readFileSync(new URL("../../app/features/compliance.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");

const crew = { role: "operator", canSeeMoney: false, companyId: "newco" };
const office = { role: "admin", canSeeMoney: true, companyId: "newco" };

test("a new quote starts on the job or primary trade and does not invent a section", () => {
  const plumbingFirst = { enabled: ["plumbing", "earthworks"] };
  assert.equal(startingQuoteTrade(plumbingFirst), "plumbing");
  assert.equal(startingQuoteTrade({ enabled: ["earthworks", "plumbing"] }, { type: "pl-rough" }), "plumbing");
  assert.equal(startingQuoteTrade({ enabled: ["earthworks"] }), "earthworks");
  assert.deepEqual(normalizeQuoteSections({ sections: [] }), []);
  assert.equal(normalizeQuoteSections({ type: "spoil", machines: ["truck"] }).length, 1);
  assert.match(quotes, /state\.sections = \[\]/);
  assert.doesNotMatch(quotes, /blankSection\(firstType\)/);
  const needed = ratesNeededHtml({ packId: "plumbing", totalEx: null }, s => String(s ?? ""));
  assert.match(needed, /Rates needed/);
  assert.match(needed, /Plumbing/);
  assert.match(needed, /Open Plumbing quote rates/);
  assert.match(needed, /data-rates-trade="plumbing"/);
  assert.doesNotMatch(needed, /\$/);
});

test("job categories are grouped, duplicate Other labels are named by trade, and plumbing does not default to spoil", () => {
  const setup = { enabled: ["plumbing", "earthworks"] };
  const groups = jobCategoryGroups(setup);
  assert.deepEqual(groups.map(g => g.tradeId), ["plumbing", "earthworks"]);
  const labels = groups.flatMap(g => g.categories.map(c => c.optionLabel));
  assert.ok(labels.includes("Plumbing – Other"));
  assert.ok(labels.includes("Earthworks – Other"));
  const html = jobCategorySelectHtml(setup, "");
  assert.match(html, /<optgroup label="Plumbing">/);
  assert.match(html, /<optgroup label="Earthworks">/);
  assert.equal((html.match(/value="pl-other"/g) || []).length, 1);
  assert.equal((html.match(/value="other"/g) || []).length, 1);
  assert.match(html, /Choose category/);
  assert.equal(defaultJobCategory(setup), "");
  assert.equal(defaultJobCategory({ enabled: ["earthworks"] }), "spoil");
  assert.equal(jobCategoryGroups({ enabled: ["earthworks"] }).flatMap(g => g.categories).find(c => c.id === "other").optionLabel, "Other");
});

test("sign-up marks required fields and reports each missing one", () => {
  const html = signupFormHtml();
  assert.match(html, /novalidate/);
  assert.match(html, /class="req"/);
  assert.match(html, /data-err="ownerName"/);
  assert.match(html, /data-err="abn"/);
  assert.match(html, /including on a trial/);
  assert.match(html, /needs an ABN/);
  assert.match(html, /name="addCard"/);
  assert.doesNotMatch(html, /name="trades"[^>]*checked/);
  const errors = signupFieldErrors({});
  assert.match(html, /name="street"/);
  assert.match(html, /name="suburb"/);
  assert.match(html, /name="state"/);
  assert.match(html, /name="postcode"/);
  assert.match(html, /QLD — Queensland/);
  assert.doesNotMatch(html, /name="address"/);
  for (const field of ["ownerName", "ownerEmail", "password", "trades", "name", "legalName", "abn", "street", "suburb", "state", "postcode", "email"]) {
    assert.ok(errors.some(row => row.field === field), field);
  }
  const filled = signupFieldErrors({
    ownerName: "Ada", ownerEmail: "ada@example.com", password: "long-enough", trades: ["plumbing"],
    name: "Ada Plumbing", legalName: "Ada Plumbing Pty Ltd", abn: "12 345 678 901",
    street: "1 Creek St", suburb: "Chuwar", state: "QLD", postcode: "4306",
    email: "office@ada.example", accountsEmail: "",
  });
  assert.deepEqual(filled, []);
});

test("add client is a form that stores the contact with the client", () => {
  const html = clientFormHtml();
  assert.match(html, /Company \/ client name/);
  assert.match(html, /name="contactName"/);
  assert.match(html, /name="phone"/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="address"/);
  assert.match(html, /name="notes"/);
  assert.doesNotMatch(app, /prompt\("Client \(company\) name:/);
  const built = buildClientCreate({
    companyId: "newco", name: "Creek Homes", contactName: "Jo", phone: "0400111222",
    email: "jo@creek.example", address: "1 Creek St", notes: "Side gate",
  });
  assert.equal(built.ok, true);
  assert.equal(built.data.companyId, "newco");
  assert.equal(built.data.contacts[0].name, "Jo");
  assert.equal(built.data.contacts[0].email, "jo@creek.example");
  assert.equal(built.data.office.address, "1 Creek St");
  const heartwood = buildClientCreate({ companyId: "heartwood", name: "Orbit Homes" });
  assert.equal(heartwood.data.companyId, undefined);
  assert.equal(buildClientCreate({ companyId: "newco", name: "" }).ok, false);
});

test("prestart explains itself and Take 5 can be started from a job and the menu", () => {
  const empty = prestartEmptyHtml({ canAdd: true });
  assert.match(empty, /A prestart is a short check/);
  assert.match(empty, /Add your first machine/);
  assert.match(prestartEmptyHtml({ canAdd: false }), /Ask a supervisor or admin/);
  assert.match(compliance, /Certificate of inspection \(COI\) – optional/);
  assert.match(compliance, /Only the name and type are required/);
  assert.match(compliance, /It is not insurance/);
  assert.equal(take5EntryVisible({ enabled: true }), true);
  assert.equal(take5EntryVisible({ enabled: false }), false);
  assert.match(take5StartButtonHtml({ enabled: true, done: false }), /Start Take 5/);
  assert.equal(take5StartButtonHtml({ enabled: true, done: true }), "");
  assert.match(app, /take5StartButtonHtml/);
  assert.match(take5StartButtonHtml({ enabled: true }), /id="starttake5"/);
  assert.match(app, /data-go="take5"/);
  assert.match(app, /take5EntryVisible/);
});

test("email job has one primary action, a copy button, and a client recipient", () => {
  const html = emailSheetHtml({ subject: "Job", body: "Hello", to: "jo@creek.example", suggestion: "jo@creek.example" });
  assert.match(html, /Other mail app/);
  assert.match(html, />Send</);
  assert.match(html, /id="jemcc"/);
  assert.match(html, />Copy</);
  assert.match(html, /Client’s email/);
  assert.match(html, /value="jo@creek.example"/);
  assert.equal((html.match(/id="jemsend"/g) || []).length, 1);
  assert.equal((html.match(/id="jemmail"/g) || []).length, 1);
});

test("help answers every role from the knowledge list and hides money from crew", async () => {
  assert.equal(helpVisible({ uid: "new-admin", role: "admin" }), true);
  assert.equal(helpVisible({ uid: "crew", role: "labourer", staffRole: "labourer" }), true);
  assert.equal(helpVisible(null), false);
  assert.match(app, /id="helpbtn"|openHelp\(/);
  assert.match(app, /Team chat/);
  const card = messagesHtml([], { helpCard: teamChatHelpCard() });
  assert.match(card, /Need help using CallUp\?/);
  assert.match(card, /Ask the assistant/);
  const job = matchHelp("How do I add a job?", office);
  assert.equal(job.go, "jobs");
  assert.match(job.text, /New Job/);
  const crewRates = matchHelp("Where do I set the quote rates?", crew);
  assert.equal(replyShowsMoney(crewRates.text), false);
  assert.doesNotMatch(crewRates.text, /\$|GST|per month/);
  const crewBill = matchHelp("How does billing work on the trial?", crew);
  assert.equal(replyShowsMoney(crewBill.text), false);
  assert.doesNotMatch(crewBill.text, /\$|A\$|per month/);
  const crewQuote = matchHelp("How do I make a quote?", crew);
  assert.doesNotMatch(crewQuote.text, /\$|GST/);
  assert.match(crewQuote.text, /Prices are not shown/);
  const offline = await askHelp("How do I do a prestart?", { ...crew, companyId: "brand-new" }, async () => {
    throw new Error("Helper is switched off.");
  });
  assert.equal(offline.source, "knowledge");
  assert.match(offline.text, /prestart/i);
  assert.equal(replyShowsMoney(offline.text), false);
  const leaked = await askHelp("what are the rates", crew, async () => ({ enabled: true, reply: "Use A$50 a month and ex GST." }));
  assert.equal(leaked.source, "knowledge");
  assert.equal(replyShowsMoney(leaked.text), false);
  const officeAnswer = await askHelp("How do I add a job?", office, async () => ({ enabled: true, reply: "Open Jobs and tap New Job." }));
  assert.equal(officeAnswer.source, "helper");
  assert.equal(helpVisible({ uid: "owner", role: "admin", companyId: "brand-new" }), true);
  assert.match(sw, /callup-shell-v154-clock-on-reminder/);
  assert.match(sw, /features\/help\.js/);
});
