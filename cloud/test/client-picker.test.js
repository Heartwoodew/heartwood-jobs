// Add a client from the New Job / Edit Job list. No network. No prices.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildClientCreate } from "../../app/features/company.js";
import { clientCreateMessage, clientFormHtml } from "../../app/features/company-ui.js";
import { matchHelp } from "../../app/features/help.js";
import {
  ADD_CLIENT_LABEL, CLIENT_MENU_LIMIT, canOfferNewClient, clientFieldHtml, clientMenuHtml, clientMenuModel,
  jobDraftAfterCancel, jobDraftAfterCreate, readJobDraft,
} from "../../app/features/client-picker.js";

const app = readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../../app/sw.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/styles.css", import.meta.url), "utf8");
const names = ["Orbit Homes", "Private", "Creek Homes"];

test("only an admin is offered a new client, and crew never see a price", () => {
  assert.equal(canOfferNewClient({ role: "admin" }), true);
  assert.equal(canOfferNewClient({ role: "admin", staffRole: "operator" }), true);
  for (const role of ["operator", "labourer", "supervisor", "manager"]) {
    assert.equal(canOfferNewClient({ role }), false, role);
  }
  assert.equal(canOfferNewClient({ role: "operator", staffRole: "admin" }), false);
  assert.equal(canOfferNewClient(null), false);
  const crew = clientMenuModel(names, "Nope", { canAdd: false });
  assert.equal(crew.items.some(item => item.type === "add"), false);
  const crewHtml = clientMenuHtml(crew);
  assert.equal(crewHtml, `<p class="client-empty">No matching client</p>`);
  assert.doesNotMatch(crewHtml, /\$|poAmount|invoiceAmount|GST/);
  const crewField = clientFieldHtml({ value: "Private", canAdd: false });
  assert.match(crewField, /name="client"/);
  assert.match(crewField, /value="Private"/);
  assert.match(crewField, /data-client-combo="pick"/);
  assert.doesNotMatch(crewField, /list="af-client"/);
  assert.doesNotMatch(crewField, /data-add-client|Add new client|\$|poAmount|invoiceAmount/);
});

test("the add option sits at the bottom, and a search with no match is prefilled", () => {
  const all = clientMenuModel(names, "", { canAdd: true });
  assert.deepEqual(all.items.slice(0, 3).map(item => item.name), names);
  assert.equal(all.items.at(-1).type, "add");
  assert.equal(all.items.at(-1).label, ADD_CLIENT_LABEL);
  assert.equal(all.items.at(-1).prefill, "");
  const partial = clientMenuModel(names, "orb", { canAdd: true });
  assert.deepEqual(partial.items.map(item => item.name || item.type), ["Orbit Homes", "add"]);
  assert.equal(partial.items.at(-1).prefill, "orb");
  assert.match(partial.items.at(-1).label, /Add new client/);
  assert.match(partial.items.at(-1).label, /orb/);
  const exact = clientMenuModel(names, "orbit homes", { canAdd: true });
  assert.equal(exact.noMatch, false);
  assert.equal(exact.items.at(-1).prefill, "");
  const missed = clientMenuModel(names, "  New Builder  ", { canAdd: true });
  assert.equal(missed.noMatch, true);
  assert.equal(missed.items.length, 1);
  assert.equal(missed.items[0].type, "add");
  assert.equal(missed.items[0].prefill, "New Builder");
  const html = clientMenuHtml(missed);
  assert.match(html, /data-add-client/);
  assert.match(html, /data-prefill="New Builder"/);
  assert.match(html, /\+ Add new client/);
  assert.doesNotMatch(html, /\$|poAmount|invoiceAmount|GST/);
  const duped = clientMenuModel(["Orbit Homes", "orbit homes", "Private"], "", { canAdd: false });
  assert.deepEqual(duped.items.map(item => item.name), ["Orbit Homes", "Private"]);
  const many = clientMenuModel(Array.from({ length: 60 }, (_, i) => `Client ${i}`), "", { canAdd: true });
  assert.equal(many.items.filter(item => item.type === "client").length, CLIENT_MENU_LIMIT);
  assert.equal(many.items.at(-1).type, "add");
  const nasty = clientMenuHtml(clientMenuModel(['<img src=x onerror=alert(1)>'], "", { canAdd: true }));
  assert.doesNotMatch(nasty, /<img/);
  assert.match(nasty, /&lt;img/);
});

test("the sheet is the Clients form, and saving selects the client without dropping the job", () => {
  const blank = clientFormHtml();
  const filled = clientFormHtml({ name: "Creek & Co" });
  for (const html of [blank, filled]) {
    assert.match(html, /id="clientnew"/);
    assert.match(html, /Company \/ client name/);
    assert.match(html, /name="contactName"/);
    assert.match(html, /name="phone"/);
    assert.match(html, /name="email"/);
    assert.match(html, /name="address"/);
    assert.match(html, /name="notes"/);
    assert.match(html, /Save client/);
    assert.doesNotMatch(html, /poAmount|invoiceAmount|\$|GST/);
  }
  assert.match(filled, /value="Creek &amp; Co"/);
  assert.equal(clientCreateMessage("email"), "Check the email address.");
  assert.equal(clientCreateMessage("phone"), "Check the phone number.");
  assert.equal(clientCreateMessage("name"), "Enter the company or client name.");
  const built = buildClientCreate({
    companyId: "newco", name: "Creek & Co", contactName: "Jo", phone: "0400111222", email: "jo@creek.example",
  });
  assert.equal(built.ok, true);
  assert.equal(built.data.companyId, "newco");
  assert.equal(built.data.tenantId, "newco");
  assert.equal(buildClientCreate({ companyId: "heartwood", name: "Orbit Homes" }).data.companyId, undefined);
  const draft = {
    client: "Or", address: "1 Creek St", description: "Dig the trench", date: "2026-11-26", time: "07:00",
    notes: "Side gate", po: "PO9", contactName: "Pat", contactPhone: "0400", contactEmail: "pat@creek.example",
    status: "Scheduled", type: "spoil",
  };
  const next = jobDraftAfterCreate(draft, "Creek & Co");
  assert.equal(next.client, "Creek & Co");
  for (const key of Object.keys(draft)) if (key !== "client") assert.equal(next[key], draft[key], key);
  assert.equal(draft.client, "Or");
  const cancelled = jobDraftAfterCancel(draft);
  assert.deepEqual(cancelled, draft);
  assert.notEqual(cancelled, draft);
  const form = { elements: { client: { value: "Or" }, address: { value: "1 Creek St" }, notes: { value: "Side gate" } } };
  assert.equal(readJobDraft(form).address, "1 Creek St");
  assert.equal(jobDraftAfterCreate(readJobDraft(form), "Creek Homes").notes, "Side gate");
});

test("New Job and Edit Job share the picker and the Clients write", () => {
  assert.match(app, /clientFieldHtml\(\{ value: j\.client \|\| "", canAdd: canOfferNewClient\(me\) \}\)/);
  assert.match(app, /wireJobClientMenu\(d\)/);
  assert.match(app, /function openClientFromJob/);
  assert.match(app, /function bindClientCreateForm/);
  assert.match(app, /clientFormHtml\(\{ name: String\(prefill \|\| ""\) \}\)/);
  assert.match(app, /id = "clientdlg"/);
  assert.equal((app.match(/doc\(db, "clients", built\.id\)/g) || []).length, 1);
  assert.match(app, /companyId: myCompanyId\(\)/);
  assert.match(app, /updatedBy: me\.uid \}, \{ merge: true \}\)/);
  const fromJob = app.slice(app.indexOf("function openClientFromJob"), app.indexOf("function bindClientCreateForm"));
  assert.match(fromJob, /jobDraftAfterCreate\(readJobDraft\(jobForm\)/);
  assert.match(fromJob, /if \(input\) input\.value = next\.client/);
  assert.doesNotMatch(fromJob, /\.address\.value\s*=/);
  assert.doesNotMatch(fromJob, /innerHTML = clientFormHtml\(\)/);
  const save = app.slice(app.indexOf("function bindClientCreateForm"), app.indexOf("function openClientForm"));
  assert.match(save, /if \(ev\.submitter\?\.value === "cancel"\) return/);
  assert.match(save, /buildClientCreate\(/);
  assert.match(save, /setDoc\(doc\(db, "clients", built\.id\)/);
  assert.match(save, /if \(onSaved\) onSaved\(built\);\s*else \{[\s\S]*?renderAdmin\(\)/);
  assert.doesNotMatch(fromJob, /renderAdmin/);
  const clientsPage = app.slice(app.indexOf("function openClientForm"), app.indexOf("function editContact"));
  assert.match(clientsPage, /bindClientCreateForm\(\$\("#clientnew"\)\)/);
  assert.match(clientsPage, /clientFormHtml\(\)/);
  assert.match(app, /data-cnew/);
  assert.match(app, /isAdm\(\) \? `<span class="headbtns"><button class="sm-btn primary" data-cnew>/);
  const office = matchHelp("how do I add a client", { role: "admin", canSeeMoney: true });
  assert.match(office.text, /\+ Add new client/);
  assert.doesNotMatch(office.text, /\$|GST|per month/);
  const crew = matchHelp("how do I add a client", { role: "labourer", canSeeMoney: false });
  assert.doesNotMatch(crew.text, /Add new client|\$|GST/);
  assert.match(css, /dialog\.clientdlg/);
  assert.match(css, /max-width:760px\)\{\s*dialog\.clientdlg\{width:100vw/);
  assert.match(sw, /callup-shell-v164/);
  assert.match(sw, /features\/client-picker\.js/);
});
