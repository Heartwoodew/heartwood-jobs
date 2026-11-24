// Suggestions stay inside one company. Crew text has prices removed. Email history is ranked
// most recent, then most used. A remembered list from another company is ignored.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emailSheetHtml } from "../../app/features/job-email.js";
import {
  bookKey, cleanEmail, collectSuggestions, descriptionPickerHtml, detailsFromClient, emailsFromRecipientDoc,
  inputAttrs, listsHtml, loadBook, matchClient, prefillPatch, pushRecentEmail, rememberBook, saveBook, unionEmails,
} from "../../app/features/autofill.js";

const NOW = Date.parse("2026-11-18T00:00:00Z");

function memory() {
  const data = new Map();
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("email suggestions are this company's, most recent then most used, plus saved contacts", () => {
  const out = collectSuggestions({
    companyId: "bravo",
    now: NOW,
    jobs: [
      { companyId: "bravo", client: "Bravo Homes", address: "1 Creek St, Ipswich", contactEmail: "site@bravo.test", supervisorName: "Pat", supervisorPhone: "0400111222", description: "Spoil removal", updatedAt: "2026-11-01T00:00:00Z" },
      { companyId: "bravo", client: "Bravo Homes", address: "1 Creek St, Ipswich", contactEmail: "site@bravo.test", description: "Spoil removal", updatedAt: "2026-11-10T00:00:00Z" },
      { companyId: "bravo", client: "Other Builder", contactEmail: "old@bravo.test", updatedAt: "2026-10-01T00:00:00Z" },
      { companyId: "heartwood", client: "Orbit Homes", address: "9 Secret St, Springfield", contactEmail: "secret@orbit.test", supervisorName: "Hidden", description: "Secret job $900", poAmount: 900, invoiceAmount: 1200 },
    ],
    clients: [
      { companyId: "bravo", name: "Bravo Homes", office: { address: "2 Office Rd, Ripley", phone: "0733334444" }, contacts: [{ name: "Jo Creek", email: "jo@bravo.test", mobile: "0400222333", kind: "supervisor", default: true }] },
      { name: "Orbit Homes", contacts: [{ name: "Secret", email: "secret@orbit.test" }] },
    ],
    receipts: [
      { companyId: "bravo", supplier: "Remondis Ipswich", createdAtIso: "2026-11-12T00:00:00Z" },
      { companyId: "bravo", supplier: "Remondis Ipswich", createdAtIso: "2026-11-02T00:00:00Z" },
      { companyId: "bravo", supplier: "Veolia", createdAtIso: "2026-11-11T00:00:00Z" },
      { companyId: "heartwood", supplier: "Secret Tip", amountInc: 80 },
    ],
    claims: [
      { companyId: "bravo", supplier: "Bunnings", amountCents: 1990 },
      { companyId: "heartwood", supplier: "Secret Shop", amountCents: 5000 },
    ],
    services: [
      { companyId: "bravo", servicedBy: "Yard workshop" },
      { companyId: "heartwood", servicedBy: "Secret workshop" },
    ],
    directoryNames: ["Bravo Homes", "Private"],
    remoteEmails: ["new@bravo.test", "not-an-email", "$50"],
    redactMoney: true,
  });
  assert.equal(out.email[0], "new@bravo.test");
  assert.ok(out.email.indexOf("site@bravo.test") < out.email.indexOf("old@bravo.test"));
  assert.ok(out.email.includes("jo@bravo.test"));
  assert.equal(out.email.includes("secret@orbit.test"), false);
  assert.equal(out.client.includes("Orbit Homes"), false);
  assert.ok(out.client.includes("Bravo Homes"));
  assert.ok(out.client.includes("Private"));
  assert.equal(out.address.includes("9 Secret St, Springfield"), false);
  assert.ok(out.address.includes("1 Creek St, Ipswich"));
  assert.ok(out.suburb.includes("Ipswich"));
  assert.equal(out.supervisor.includes("Hidden"), false);
  assert.ok(out.supervisor.includes("Pat"));
  assert.ok(out.supervisor.includes("Jo Creek"));
  assert.equal(out.phone.includes("0400111222"), true);
  assert.equal(out.supplier[0], "Remondis Ipswich");
  assert.ok(out.supplier.includes("Veolia"));
  assert.ok(out.supplier.includes("Bunnings"));
  assert.equal(out.supplier.includes("Secret Tip"), false);
  assert.equal(out.servicedBy.includes("Yard workshop"), true);
  assert.equal(out.servicedBy.includes("Secret workshop"), false);
  const blob = JSON.stringify(out);
  assert.equal(blob.includes("secret@orbit.test"), false);
  assert.equal(blob.includes("900"), false);
  assert.equal(blob.includes("1200"), false);
  assert.equal(blob.includes("1990"), false);
  assert.equal(blob.includes("$"), false);
});

test("a price in a description is removed for crew and kept for office", () => {
  const job = { companyId: "heartwood", description: "Tip fee $450 ex GST at the gate", client: "Orbit" };
  const crew = collectSuggestions({ companyId: "heartwood", jobs: [job], redactMoney: true, now: NOW });
  const office = collectSuggestions({ companyId: "heartwood", jobs: [job], redactMoney: false, now: NOW });
  assert.equal(crew.description[0], "Tip fee at the gate");
  assert.equal(crew.description.join(" ").includes("450"), false);
  assert.equal(office.description[0], "Tip fee $450 ex GST at the gate");
});

test("choosing a client fills only the empty contact, phone, email and address", () => {
  const client = {
    name: "Orbit Homes (Qld) Pty Ltd",
    office: { address: "14 Brightvale Street, Springfield", phone: "0731000000" },
    contacts: [{ name: "Jo", email: "jo@orbit.example", mobile: "0400999888", default: true }],
  };
  const details = detailsFromClient(client);
  assert.equal(details.contactName, "Jo");
  assert.equal(details.email, "jo@orbit.example");
  assert.equal(details.phone, "0400999888");
  assert.equal(details.address, "14 Brightvale Street, Springfield");
  assert.equal(details.suburb, "Springfield");
  const patch = prefillPatch({ address: "Keep this site", contactName: "", phone: "", email: "already@orbit.example" }, details);
  assert.equal(patch.address, undefined);
  assert.equal(patch.email, undefined);
  assert.equal(patch.contactName, "Jo");
  assert.equal(patch.phone, "0400999888");
  assert.equal(patch.suburb, "Springfield");
  assert.equal(matchClient("orbit homes", [client]).name, client.name);
  assert.equal(matchClient("Someone else", [client]), null);
});

test("remembered values stay on this company and this login", () => {
  const storage = memory();
  const book = rememberBook(null, {
    companyId: "bravo",
    uid: "u1",
    now: NOW,
    entries: { email: ["Ada@Bravo.test", "not-an-email"], supplier: "Remondis", address: "4 Oak St, Ripley", description: "Level pad" },
  });
  saveBook(storage, book);
  assert.match(storage.getItem(bookKey("bravo", "u1")), /ada@bravo\.test/);
  const loaded = loadBook(storage, "bravo", "u1");
  assert.equal(loaded.fields.email[0].value, "ada@bravo.test");
  assert.equal(loaded.fields.suburb[0].value, "Ripley");
  assert.deepEqual(loadBook(storage, "heartwood", "u1").fields, {});
  assert.deepEqual(loadBook(storage, "bravo", "u2").fields, {});
  const again = rememberBook(loaded, { companyId: "bravo", uid: "u1", now: NOW + 1000, entries: { email: "ada@bravo.test" } });
  assert.equal(again.fields.email[0].count, 2);
  const leaked = collectSuggestions({
    companyId: "heartwood",
    uid: "u1",
    remembered: loaded,
    now: NOW,
  });
  assert.equal(leaked.email.includes("ada@bravo.test"), false);
  const own = collectSuggestions({ companyId: "bravo", uid: "u1", remembered: loaded, now: NOW });
  assert.equal(own.email.includes("ada@bravo.test"), true);
  assert.equal(own.supplier.includes("Remondis"), true);
});

test("sent recipients move to the front and ignore another company's doc", () => {
  assert.deepEqual(pushRecentEmail(["a@bravo.test", "b@bravo.test"], "B@Bravo.test"), ["b@bravo.test", "a@bravo.test"]);
  assert.equal(pushRecentEmail(Array.from({ length: 50 }, (_, i) => `p${i}@bravo.test`), "new@bravo.test").length, 40);
  assert.equal(pushRecentEmail(["a@bravo.test"], "not-an-email")[0], "a@bravo.test");
  assert.deepEqual(emailsFromRecipientDoc({ companyId: "heartwood", emails: ["secret@orbit.test", "nope"] }, "bravo"), []);
  assert.deepEqual(emailsFromRecipientDoc({ companyId: "bravo", emails: ["Jo@Bravo.test", "$20", "jo@bravo.test"] }, "bravo"), ["jo@bravo.test"]);
  assert.deepEqual(unionEmails(["a@bravo.test"], ["b@bravo.test", "a@bravo.test"]), ["a@bravo.test", "b@bravo.test"]);
});

test("suggestion markup is attributes and escaped options, with no prices", () => {
  assert.match(inputAttrs("email"), /type="email"/);
  assert.match(inputAttrs("email"), /autocomplete="email"/);
  assert.match(inputAttrs("email"), /inputmode="email"/);
  assert.match(inputAttrs("phone"), /type="tel"/);
  assert.match(inputAttrs("address"), /autocomplete="street-address"/);
  assert.match(inputAttrs("client"), /list="af-client"/);
  const html = listsHtml({ supplier: ['Remondis "Ipswich"', "Veolia"] });
  assert.match(html, /id="af-supplier"/);
  assert.match(html, /Remondis &quot;Ipswich&quot;/);
  assert.doesNotMatch(html, /\$/);
  const picker = descriptionPickerHtml(['Dig & fill', 'Spoil $20']);
  assert.match(picker, /data-af-fill="description"/);
  assert.match(picker, /Dig &amp; fill/);
  assert.equal(descriptionPickerHtml([]), "");
  const sheet = emailSheetHtml({
    subject: "Job",
    body: "Hello",
    to: "jo@bravo.test",
    suggestion: "jo@bravo.test",
    suggestions: ["jo@bravo.test", "Secret@orbit.test", "not-an-email", "$80"],
  });
  assert.match(sheet, /list="jememails"/);
  assert.match(sheet, /autocomplete="email"/);
  assert.match(sheet, /value="jo@bravo\.test"/);
  assert.match(sheet, /value="secret@orbit\.test"/);
  assert.doesNotMatch(sheet, /not-an-email/);
  assert.doesNotMatch(sheet, /\$80/);
  assert.equal(cleanEmail("$80"), "");
});

test("autofill rules are the same in the emulator model and the production rules", () => {
  const slice = text => {
    const start = text.indexOf("// BEGIN AUTOFILL RULES");
    const end = text.indexOf("// END AUTOFILL RULES");
    assert.ok(start >= 0 && end > start);
    return text.slice(start, end);
  };
  const emu = readFileSync(new URL("../emulator/firestore.rules", import.meta.url), "utf8");
  const prod = readFileSync(new URL("../firestore.production.rules", import.meta.url), "utf8");
  assert.equal(slice(emu), slice(prod));
  const block = slice(prod);
  assert.match(block, /match \/companies\/\{companyId\}\/autofill\/\{docId\}/);
  assert.match(block, /allow list: if false/);
  assert.match(block, /allow delete: if false/);
  assert.match(block, /d\.keys\(\)\.hasOnly\(\["companyId", "emails", "updatedAt", "updatedBy"\]\)/);
  assert.match(block, /d\.emails\.size\(\) <= 40/);
  assert.match(block, /profile\(\)\.get\("role", ""\) in \["admin", "supervisor", "manager"\]/);
  assert.match(block, /companyOpen\(companyId\)/);
  assert.doesNotMatch(block, /poAmount|invoiceAmount|amount/);
});

test("the service worker cache is callup-shell-v158-stop-series and includes autofill.js", () => {
  const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
  assert.match(sw, /callup-shell-v158-stop-series/);
  assert.match(sw, /features\/autofill\.js/);
});
