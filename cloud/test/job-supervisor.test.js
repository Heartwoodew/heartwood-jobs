import test from "node:test";
import assert from "node:assert/strict";
import {
  canEditJobSupervisor, canSaveSupervisorContact, explicitSupervisor, mergeSupervisorContact,
  resolveJobSupervisor, supervisorContactDefaultOn, supervisorJobFields,
} from "../../app/features/job-supervisor.js";

const ORBIT = [{ kind: "supervisor", name: "Dana Lee", mobile: "0400 111 222", email: "dana@example.test", role: "Supervisor" }];

test("admins and supervisors can set a job supervisor; operators cannot", () => {
  assert.equal(canEditJobSupervisor({ role: "admin" }), true);
  assert.equal(canEditJobSupervisor({ role: "supervisor" }), true);
  assert.equal(canEditJobSupervisor({ role: "operator", staffRole: "supervisor" }), true);
  assert.equal(canEditJobSupervisor({ role: "operator" }), false);
  assert.equal(canEditJobSupervisor({ role: "operator", staffRole: "operator" }), false);
  assert.equal(canEditJobSupervisor(null), false);
});

test("saving onto the client list follows who can already write clients", () => {
  assert.equal(canSaveSupervisorContact({ role: "admin" }, "heartwood"), true);
  assert.equal(canSaveSupervisorContact({ role: "admin" }, "bravo"), true);
  assert.equal(canSaveSupervisorContact({ role: "supervisor" }, "bravo"), true);
  assert.equal(canSaveSupervisorContact({ role: "supervisor" }, "heartwood"), false);
  assert.equal(canSaveSupervisorContact({ role: "operator" }, "bravo"), false);
  assert.equal(supervisorContactDefaultOn({ role: "admin" }), true);
  assert.equal(supervisorContactDefaultOn({ role: "supervisor" }), false);
});

test("job fields win, then a remembered email, then the client's supervisors", () => {
  const job = { client: "Orbit Homes (Qld) Pty Ltd", po: "110210/100/01", supervisorName: "Dave Brown", supervisorEmail: "dave@example.test", contactPhone: "0412 345 678" };
  const shown = resolveJobSupervisor(job, { email: "other@example.test", name: "Other" }, ORBIT);
  assert.equal(shown.name, "Dave Brown");
  assert.equal(shown.email, "dave@example.test");
  assert.equal(shown.mobile, "0412 345 678");

  const fromClient = resolveJobSupervisor({ po: "110210/100/01", client: "Orbit" }, null, ORBIT);
  assert.equal(fromClient.name, "Dana Lee");
  assert.equal(fromClient.mobile, "0400 111 222");

  const remembered = resolveJobSupervisor({ po: "", client: "Orbit" }, { email: "jake@example.test", name: "Jake" }, ORBIT);
  assert.equal(remembered.email, "jake@example.test");
  assert.equal(remembered.name, "Jake");

  const byPo = resolveJobSupervisor({ po: "110210/100/01" }, null, [
    { kind: "supervisor", name: "Pat", pos: ["999"] },
    { kind: "supervisor", name: "Dana Lee", pos: ["110210"], mobile: "0400 111 222" },
  ]);
  assert.equal(byPo.name, "Dana Lee");

  const fallback = resolveJobSupervisor({ po: "1/2" }, null, [
    { kind: "supervisor", name: "A" },
    { kind: "supervisor", name: "B", default: true, mobile: "0400" },
  ]);
  assert.equal(fallback.name, "B");
  assert.equal(resolveJobSupervisor({ contactPhone: "0411" }, null, []), null);
  assert.deepEqual(explicitSupervisor({ supervisorName: "Dave" }), { name: "Dave", email: "", mobile: "" });
});

test("the job patch uses the existing supervisor field names", () => {
  const ok = supervisorJobFields({ name: " Dave Brown ", email: "dave@example.test", mobile: "0412 345 678" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.fields, {
    supervisorName: "Dave Brown",
    contactName: "Dave Brown",
    supervisorEmail: "dave@example.test",
    contactPhone: "0412 345 678",
  });
  assert.equal(supervisorJobFields({ name: "  ", email: "", mobile: "" }).ok, false);
  assert.match(supervisorJobFields({ name: "Dave", email: "not-an-email", mobile: "" }).error, /email/i);
  assert.equal(supervisorJobFields({ name: "Dave", email: "", mobile: "" }).ok, true);
});

test("a saved contact is updated in place, not duplicated", () => {
  const first = mergeSupervisorContact(ORBIT, { name: "Dana Lee", email: "dana@example.test", mobile: "0499 000 111" });
  assert.equal(first.length, 1);
  assert.equal(first[0].mobile, "0499 000 111");
  assert.equal(first[0].role, "Supervisor");
  const added = mergeSupervisorContact(first, { name: "Dave Brown", email: "dave@example.test", mobile: "0412 345 678" });
  assert.equal(added.length, 2);
  assert.equal(added[1].kind, "supervisor");
  assert.equal(added[1].source, "Added from a job");
  const accounts = mergeSupervisorContact([{ kind: "accounts", name: "Accounts", email: "acc@example.test" }], {
    name: "Dave Brown", email: "dave@example.test", mobile: "0412",
  });
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].kind, "accounts");
});
