import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LONG_PRESS_MS, addDaysIso, bindBoardDrag, blockDays, canEditJobDate, dayDelta, dragBlockReason,
  dragGhostText, dropFromCell, gridFraction, insertBeforeId, planDispatchDrop, shiftBlock, snapQuarter, timeBetween,
} from "../app/features/dispatch-drag.js";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../cloud/firestore.production.rules", import.meta.url), "utf8");

function job(extra = {}) {
  return {
    id: "j1", date: "2026-11-06", time: "08:30", timeSource: "auto", status: "Scheduled",
    address: "21 Lumen Street, Redbank Plains", durationHrs: 2, assigned: ["sam"], assignedNames: ["Sam"],
    ...extra,
  };
}

test("only office roles that the job rules already allow can change a date", () => {
  assert.equal(canEditJobDate({ role: "admin", companyId: "heartwood" }), true);
  assert.equal(canEditJobDate({ role: "admin", staffRole: "admin", companyId: "heartwood" }), true);
  assert.equal(canEditJobDate({ role: "admin", staffRole: "operator", companyId: "heartwood" }), true);
  assert.equal(canEditJobDate({ role: "admin", staffRole: "manager", companyId: "heartwood" }), false);
  assert.equal(canEditJobDate({ role: "supervisor", companyId: "heartwood" }), false);
  assert.equal(canEditJobDate({ role: "manager", companyId: "heartwood" }), false);
  assert.equal(canEditJobDate({ role: "operator", companyId: "heartwood" }), false);
  assert.equal(canEditJobDate({ role: "labourer", companyId: "acme" }), false);
  assert.equal(canEditJobDate({ role: "admin", companyId: "acme" }), true);
  assert.equal(canEditJobDate({ role: "supervisor", companyId: "acme" }), true);
  assert.equal(canEditJobDate({ role: "manager", staffRole: "manager", companyId: "acme" }), true);
  assert.equal(canEditJobDate({ role: "operator", staffRole: "supervisor", companyId: "acme" }), false);
  assert.equal(canEditJobDate(null), false);
});

test("completed and invoiced jobs are not draggable", () => {
  assert.equal(dragBlockReason(job()), "");
  assert.equal(dragBlockReason(job({ status: "In progress" })), "");
  assert.equal(dragBlockReason(job({ status: "Done" })), "completed");
  assert.equal(dragBlockReason(job({ sm8Status: "Completed" })), "completed");
  assert.equal(dragBlockReason(job({ invoiced: true, status: "Scheduled" })), "invoiced");
  assert.equal(dragBlockReason(job({ xeroCheck: { status: "invoiced" } })), "invoiced");
  assert.equal(dragBlockReason(job({ invoiceNo: "5502", invoiced: false })), "");
});

test("a day-grid drop snaps to 15 minutes", () => {
  assert.equal(snapQuarter(7, 0), "07:00");
  assert.equal(snapQuarter(7, 0.24), "07:00");
  assert.equal(snapQuarter(7, 0.25), "07:15");
  assert.equal(snapQuarter(7, 0.49), "07:15");
  assert.equal(snapQuarter(7, 0.5), "07:30");
  assert.equal(snapQuarter(7, 0.74), "07:30");
  assert.equal(snapQuarter(7, 0.75), "07:45");
  assert.equal(snapQuarter(7, 1), "07:45");
  assert.equal(snapQuarter(18, 0.9), "18:45");
  assert.equal(snapQuarter("6", 0), "06:00");
  assert.equal(snapQuarter("", 0.5), "");
  assert.equal(gridFraction({ top: 100, height: 80 }, 140), 0.5);
  const dropped = planDispatchDrop(job(), { date: "2026-11-06", grid: true, hour: 9, fraction: 0.5, fromKey: "sam", toKey: "sam" });
  assert.equal(dropped.ok, true);
  assert.equal(dropped.patch.time, "09:30");
  assert.equal(dropped.patch.timeSource, "manual");
  assert.equal(dropped.timeNote, "Snapped to 15 minutes.");
  assert.equal("date" in dropped.patch, false);
  assert.deepEqual(Object.keys(dropped.patch).sort(), ["time", "timeSource"]);
});

test("a week drop between jobs sets a start that keeps the order", () => {
  const lane = [{ id: "a", time: "07:00" }, { id: "b", time: "09:00" }];
  const between = planDispatchDrop(job({ id: "mid", time: "07:00" }), {
    date: "2026-11-06", reorder: true, beforeId: "b", lane, fromKey: "sam", toKey: "sam",
  });
  assert.equal(between.ok, true);
  assert.equal(between.patch.time, "08:00");
  assert.equal(between.patch.timeSource, "manual");
  assert.match(between.timeNote, /15-minute/);
  const tight = timeBetween("07:00", "07:10");
  assert.equal(tight.time, "07:01");
  assert.equal(tight.mode, "minute");
  const after = timeBetween("17:50", null);
  assert.equal(after.time, "18:00");
  assert.equal(after.mode, "quarter");
  const before = timeBetween(null, "08:00");
  assert.equal(before.mode, "quarter");
  assert.ok(before.time < "08:00");
  assert.equal(before.time.endsWith("00") || before.time.endsWith("15") || before.time.endsWith("30") || before.time.endsWith("45"), true);
  const empty = planDispatchDrop(job(), {
    date: "2026-11-10", reorder: true, lane: [], fromKey: "sam", toKey: "sam",
  });
  assert.equal(empty.ok, true);
  assert.equal(empty.patch.date, "2026-11-10");
  assert.equal("time" in empty.patch, false);
  const same = planDispatchDrop(job({ time: "09:30", timeSource: "manual" }), {
    date: "2026-11-06", grid: true, hour: 9, fraction: 0.5, fromKey: "sam", toKey: "sam",
  });
  assert.equal(same.ok, false);
  assert.equal(same.reason, "same");
});

test("dropping onto another person is a reassignment, and a no-op drop is ignored", () => {
  const moved = planDispatchDrop(job(), { date: "2026-11-06", fromKey: "sam", toKey: "pat" });
  assert.equal(moved.ok, true);
  assert.equal(moved.staffChanged, true);
  assert.equal(moved.toKey, "pat");
  assert.deepEqual(moved.patch, {});
  const blocked = planDispatchDrop(job({ status: "Done" }), { date: "2026-11-07", toKey: "pat", fromKey: "sam" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "completed");
});

test("a multi-day job moves as one block", () => {
  const span = job({ endDate: "2026-11-08", dateEnd: "2026-11-07", durationHrs: 30, time: "22:00" });
  assert.equal(blockDays(span) > 1, true);
  assert.equal(dayDelta("2026-11-06", "2026-11-10"), 4);
  assert.equal(addDaysIso("2026-11-06", 4), "2026-11-10");
  const shifted = shiftBlock(span, "2026-11-10");
  assert.deepEqual(shifted, { date: "2026-11-10", endDate: "2026-11-12", dateEnd: "2026-11-11" });
  const planned = planDispatchDrop(span, { date: "2026-11-10", reorder: true, lane: [], fromKey: "sam", toKey: "sam" });
  assert.equal(planned.patch.date, "2026-11-10");
  assert.equal(planned.patch.endDate, "2026-11-12");
  assert.equal(planned.patch.dateEnd, "2026-11-11");
  assert.equal("durationHrs" in planned.patch, false);
  assert.equal(shiftBlock(job(), "2026-11-06").date, "2026-11-06");
  assert.equal("endDate" in shiftBlock(job(), "2026-11-09"), false);
});

test("the drag label never includes a price", () => {
  const text = dragGhostText(job({
    invoiceAmount: 8800, poAmount: 500, quoteAmount: 1200, invoiced: false,
    address: "Lot 4, $50 note",
  }));
  assert.equal(text.includes("8800"), false);
  assert.equal(text.includes("500"), false);
  assert.equal(text.includes("$"), false);
  assert.match(text, /08:30/);
  assert.match(text, /Lot 4/);
  const days = dragGhostText(job({ endDate: "2026-11-08" }));
  assert.match(days, /3-day block/);
});

test("a drop on a cell reads the hour, the gap, or the day strip", () => {
  const chips = [
    { id: "a", time: "07:00", rect: { top: 0, bottom: 40 } },
    { id: "b", time: "09:00", rect: { top: 50, bottom: 90 } },
  ];
  const week = fakeCell({ date: "2026-11-07", staff: "pat", chips });
  const into = dropFromCell(week, 45, { fromKey: "sam", jobId: "mid" });
  assert.equal(into.grid, false);
  assert.equal(into.reorder, true);
  assert.equal(into.beforeId, "b");
  assert.equal(into.toKey, "pat");
  assert.deepEqual(into.lane.map(row => row.id), ["a", "b"]);
  const hour = fakeCell({ date: "2026-11-06", hour: "9", staff: "sam", top: 0, height: 100 });
  const grid = dropFromCell(hour, 60, { fromKey: "sam", jobId: "j1" });
  assert.equal(grid.grid, true);
  assert.equal(grid.hour, "9");
  assert.equal(grid.fraction, 0.6);
  const strip = fakeCell({ mday: "2026-11-08", date: "2026-11-08", strip: true });
  const day = dropFromCell(strip, 10, { fromKey: "sam", jobId: "j1" });
  assert.equal(day.reorder, false);
  assert.equal(day.date, "2026-11-08");
  assert.equal(day.toKey, "sam");
  assert.equal(insertBeforeId([{ id: "a", top: 0, bottom: 20 }], 5), "a");
  assert.equal(insertBeforeId([{ id: "a", top: 0, bottom: 20 }], 30), "");
});

test("the board saves a drag through the job form's write and offers undo", () => {
  const move = app.slice(app.indexOf("async function dispatchMove"), app.indexOf("async function unscheduleJob"));
  assert.match(move, /planDispatchDrop/);
  assert.match(move, /writeJob\(j\.id, u\)/);
  assert.match(move, /writeJob\(j\.id, back\)/);
  assert.match(move, /undoToast\(/);
  assert.match(move, /queueDispatchPersist/);
  assert.match(move, /editedInApp: true/);
  assert.match(move, /updatedBy: me\.uid/);
  assert.match(move, /confirmIfOnLeave/);
  assert.doesNotMatch(move, /poAmount|invoiceAmount|quoteAmount/);
  const form = app.slice(app.indexOf("f.onsubmit = async ev"), app.indexOf("function jobTabs"));
  assert.match(form, /writeJob\(j\.id, data\)/);
  assert.match(form, /timeTouched/);
  assert.match(form, /date: f\.date\.value, time: f\.time\.value/);
  assert.match(form, /queueDispatchPersist/);
  assert.match(app, /bindBoardDrag/);
  assert.match(app, /LONG_PRESS_MS/);
  assert.equal(LONG_PRESS_MS >= 400, true);
  assert.match(sw, /callup-shell-v156-dispatch-drag/);
  assert.match(sw, /features\/dispatch-drag\.js/);
  assert.match(app, /callup-shell-v156-dispatch-drag/);
});

test("crew still cannot write a job date under the Firestore rules", () => {
  const at = rules.indexOf('["status", "log", "loads"');
  assert.ok(at > 0);
  const list = rules.slice(at, rules.indexOf("]", at));
  assert.match(list, /updatedAt/);
  assert.doesNotMatch(list, /"date"/);
  assert.doesNotMatch(list, /"time"/);
  assert.doesNotMatch(list, /"assigned"/);
  const office = rules.indexOf("allow update: if companyOffice()");
  assert.ok(office > 0);
});

test("a mouse drag onto an hour cell reports the snapped drop", () => {
  const cell = {
    classList: classList(),
    dataset: { date: "2026-11-07", hour: "10", staff: "sam" },
    closest(sel) { return String(sel).includes("drop") ? cell : null; },
    getBoundingClientRect() { return { top: 0, height: 100, bottom: 100 }; },
    querySelectorAll() { return []; },
    appendChild() {},
  };
  const doc = fakeDoc();
  doc.elementsFromPoint = () => [cell];
  const root = fakeRoot(doc);
  let drop = null;
  bindBoardDrag(root, {
    job: () => job(),
    canDrag: () => true,
    ghost: () => "08:30 Lumen",
    onDrop: (_job, next) => { drop = next; },
  });
  const chip = fakeChip("j1");
  root.listeners.pointerdown({ button: 0, pointerId: 4, pointerType: "mouse", clientX: 0, clientY: 0, target: chip });
  doc.listeners.pointermove({ pointerId: 4, pointerType: "mouse", clientX: 12, clientY: 8, preventDefault() {} });
  doc.listeners.pointerup({ pointerId: 4, clientX: 12, clientY: 80 });
  assert.ok(drop);
  assert.equal(drop.grid, true);
  assert.equal(drop.hour, "10");
  assert.equal(drop.fraction, 0.8);
});

test("pointer drag unbinds, and a long-press is what starts a touch drag", () => {
  const doc = fakeDoc();
  const root = fakeRoot(doc);
  let dropped = 0;
  const unbind = bindBoardDrag(root, {
    job: () => job(),
    canDrag: () => true,
    ghost: () => "08:30 Lumen",
    onDrop: () => { dropped += 1; },
    onBlocked: () => {},
  });
  assert.equal(typeof root.listeners.pointerdown, "function");
  assert.equal(typeof doc.listeners.pointermove, "function");
  const chip = fakeChip("j1");
  root.listeners.pointerdown({ button: 0, pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10, target: chip });
  doc.listeners.pointermove({ pointerId: 1, pointerType: "touch", clientX: 40, clientY: 10, preventDefault() {} });
  doc.listeners.pointerup({ pointerId: 1, clientX: 40, clientY: 10 });
  assert.equal(dropped, 0);
  unbind();
  assert.equal(root.listeners.pointerdown, undefined);
  assert.equal(doc.listeners.pointermove, undefined);
});

function fakeCell({ date = "", hour = "", staff = "", mday = "", strip = false, chips = [], top = 0, height = 100 } = {}) {
  return {
    dataset: { date, hour, staff, mday },
    closest(sel) { return strip && sel === ".mstrip" ? { className: "mstrip" } : null; },
    getBoundingClientRect() { return { top, height, bottom: top + height }; },
    querySelectorAll() {
      return chips.map(chip => ({
        dataset: { id: chip.id, time: chip.time },
        getBoundingClientRect() { return chip.rect; },
      }));
    },
  };
}

function classList() {
  const names = new Set();
  return {
    add(name) { names.add(name); },
    remove(name) { names.delete(name); },
    contains(name) { return names.has(name); },
  };
}

function fakeDoc() {
  return {
    listeners: {},
    body: { classList: classList(), appendChild() {}, removeChild() {} },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener(type) { delete this.listeners[type]; },
    createElement() { return { className: "", textContent: "", style: {}, remove() {} }; },
    querySelector() { return null; },
    elementsFromPoint() { return []; },
  };
}

function fakeRoot(doc) {
  return {
    ownerDocument: doc,
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener(type) { delete this.listeners[type]; },
    contains() { return true; },
    querySelectorAll() { return []; },
  };
}

function fakeChip(id) {
  const node = {
    dataset: { id, time: "08:30", staff: "" },
    classList: classList(),
    closest(sel) {
      if (sel.includes("dchip") || sel.includes("mdc")) return node;
      return null;
    },
    setPointerCapture() {},
  };
  return node;
}
