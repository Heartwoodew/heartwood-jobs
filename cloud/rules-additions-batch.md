# Firestore rule additions versus current main

Compared with `main` at `c8f4a07` (knowledge pack #15, which includes staff invites from #14, merge `a8451a0`).

`cloud/emulator/firestore.rules` is the combined emulator model. It already holds every block below, plus the blocks already on main: INVITE, CHAT, FLEET, SWMS SIGNATURE, and RUN SHEET. Do not deploy that file. Paste only the new or changed blocks into the live rules.

Main already contains these blocks. None of the four features below replace them:

- `// BEGIN INVITE RULES` … `// END INVITE RULES` (`cloud/production/firestore.invites.rules`)
- `// BEGIN CHAT RULES` … `// END CHAT RULES`
- `// BEGIN FLEET RULES` … `// END FLEET RULES` (changed by servicing; see below)
- `// BEGIN SWMS SIGNATURE RULES` … `// END SWMS SIGNATURE RULES`
- `// BEGIN RUN SHEET RULES` … `// END RUN SHEET RULES`

## Rebrand (#16)

No Firestore rule blocks. Organisation settings stay on the phone.

## Servicing and prestart (#13)

### Changed block already on main: FLEET

`fleetAssetOk` now allows an optional `prestartKind`. The rest of the FLEET block is unchanged. The integrated block matches `cloud/production/firestore.fleet.rules`.

```
--- main FLEET block
+++ integrated FLEET block
@@ -28,8 +28,9 @@
       return v is string && (v == "" || v.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'));
     }
     function fleetAssetOk() {
-      return request.resource.data.keys().hasOnly(["type", "name", "rego", "regoExpiry", "coiRequired", "coiExpiry", "notes", "updatedAt", "updatedBy"])
+      return request.resource.data.keys().hasOnly(["type", "name", "rego", "regoExpiry", "coiRequired", "coiExpiry", "notes", "prestartKind", "updatedAt", "updatedBy"])
         && (request.resource.data.type == "vehicle" || request.resource.data.type == "trailer" || request.resource.data.type == "plant")
+        && (!("prestartKind" in request.resource.data) || request.resource.data.prestartKind == "skid-steer" || request.resource.data.prestartKind == "excavator" || request.resource.data.prestartKind == "tip-truck" || request.resource.data.prestartKind == "ute" || request.resource.data.prestartKind == "trailer" || request.resource.data.prestartKind == "other-plant")
         && request.resource.data.name is string
         && request.resource.data.name.size() > 0
         && request.resource.data.name.size() <= 80
```

### Added block: SERVICING

Paste inside `match /databases/{database}/documents`. Source: `cloud/production/firestore.servicing.rules`. The emulator slice is identical.

```
// BEGIN SERVICING RULES
    function svcSignedIn() { return request.auth != null; }
    function svcIsAlex() { return svcSignedIn() && request.auth.uid == "1JKLsoxkQNfkphBBO0vDz2ziEyj2"; }
    function svcIsPatrick() { return svcSignedIn() && request.auth.uid == "R7t41e54Ykcdk9WPdVZnDd697iI2"; }
    function svcUserPath() { return /databases/$(database)/documents/users/$(request.auth.uid); }
    function svcHasProfile() { return svcSignedIn() && exists(svcUserPath()); }
    function svcProfile() { return get(svcUserPath()).data; }
    function svcExplicitTenant() {
      return svcHasProfile() && "tenantId" in svcProfile() && svcProfile().tenantId is string && svcProfile().tenantId.size() > 0;
    }
    function svcCallerTenant() {
      return svcExplicitTenant()
        ? svcProfile().tenantId
        : ((svcHasProfile() || svcIsAlex() || svcIsPatrick()) ? "heartwood" : "");
    }
    function svcMember(tenantId) {
      return svcSignedIn()
        && tenantId is string
        && tenantId.matches('^[a-z0-9][a-z0-9-]{0,39}$')
        && svcCallerTenant() == tenantId;
    }
    function svcAdmin(tenantId) {
      return svcMember(tenantId) && (
        svcIsAlex() || svcIsPatrick() || (svcHasProfile() && "role" in svcProfile() && svcProfile().role == "admin")
      );
    }
    function svcWriter(tenantId) {
      return svcAdmin(tenantId)
        || (svcMember(tenantId) && svcHasProfile() && "role" in svcProfile() && svcProfile().role == "supervisor");
    }
    function svcInt(v, max) {
      return v is int && v >= 0 && v <= max;
    }
    function svcUnit(v) {
      return v == "" || v == "hours" || v == "km";
    }
    function svcDate(v) {
      return v is string && v.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    }
    function svcRecordOk() {
      return request.resource.data.keys().hasOnly(["assetId", "doneOn", "reading", "readingUnit", "serviceType", "servicedBy", "notes", "updatedAt", "updatedBy"])
        && request.resource.data.assetId is string
        && request.resource.data.assetId.matches('^[A-Za-z0-9_-]{1,80}$')
        && svcDate(request.resource.data.doneOn)
        && svcInt(request.resource.data.reading, 10000000)
        && svcUnit(request.resource.data.readingUnit)
        && (request.resource.data.reading == 0 || request.resource.data.readingUnit == "hours" || request.resource.data.readingUnit == "km")
        && (request.resource.data.serviceType == "250hr" || request.resource.data.serviceType == "major" || request.resource.data.serviceType == "repair" || request.resource.data.serviceType == "other")
        && request.resource.data.servicedBy is string
        && request.resource.data.servicedBy.size() <= 120
        && request.resource.data.notes is string
        && request.resource.data.notes.size() <= 2000
        && request.resource.data.updatedBy == request.auth.uid
        && request.resource.data.updatedAt == request.time;
    }
    function svcPlanOk() {
      return request.resource.data.keys().hasOnly(["everyDays", "everyReading", "readingUnit", "currentReading", "updatedAt", "updatedBy"])
        && svcInt(request.resource.data.everyDays, 3650)
        && svcInt(request.resource.data.everyReading, 1000000)
        && svcInt(request.resource.data.currentReading, 10000000)
        && svcUnit(request.resource.data.readingUnit)
        && (request.resource.data.everyReading == 0 || request.resource.data.readingUnit == "hours" || request.resource.data.readingUnit == "km")
        && request.resource.data.updatedBy == request.auth.uid
        && request.resource.data.updatedAt == request.time;
    }
    function svcCostOk() {
      return request.resource.data.keys().hasOnly(["amount", "updatedAt", "updatedBy"])
        && request.resource.data.amount is string
        && request.resource.data.amount.size() > 0
        && request.resource.data.amount.size() <= 40
        && request.resource.data.updatedBy == request.auth.uid
        && request.resource.data.updatedAt == request.time;
    }

    match /tenants/{tenantId}/servicing/{recordId} {
      allow read: if svcMember(tenantId);
      allow create, update: if svcWriter(tenantId) && svcRecordOk();
      allow delete: if svcWriter(tenantId);
    }

    match /tenants/{tenantId}/servicePlans/{assetId} {
      allow read: if svcMember(tenantId);
      allow create, update: if svcWriter(tenantId) && svcPlanOk();
      allow delete: if svcWriter(tenantId);
    }

    match /tenants/{tenantId}/serviceCosts/{recordId} {
      allow read: if svcWriter(tenantId);
      allow create, update: if svcWriter(tenantId) && svcCostOk();
      allow delete: if svcWriter(tenantId);
    }
// END SERVICING RULES
```

### Added block: PRESTART

Paste inside `match /databases/{database}/documents`. Source: `cloud/production/firestore.prestart.rules`. The emulator slice is identical.

```
// BEGIN PRESTART RULES
    function psSignedIn() { return request.auth != null; }
    function psIsAlex() { return psSignedIn() && request.auth.uid == "1JKLsoxkQNfkphBBO0vDz2ziEyj2"; }
    function psIsPatrick() { return psSignedIn() && request.auth.uid == "R7t41e54Ykcdk9WPdVZnDd697iI2"; }
    function psUserPath() { return /databases/$(database)/documents/users/$(request.auth.uid); }
    function psHasProfile() { return psSignedIn() && exists(psUserPath()); }
    function psProfile() { return get(psUserPath()).data; }
    function psExplicitTenant() {
      return psHasProfile() && "tenantId" in psProfile() && psProfile().tenantId is string && psProfile().tenantId.size() > 0;
    }
    function psCallerTenant() {
      return psExplicitTenant()
        ? psProfile().tenantId
        : ((psHasProfile() || psIsAlex() || psIsPatrick()) ? "heartwood" : "");
    }
    function psMember(tenantId) {
      return psSignedIn()
        && tenantId is string
        && tenantId.matches('^[a-z0-9][a-z0-9-]{0,39}$')
        && psCallerTenant() == tenantId;
    }
    function psAdmin(tenantId) {
      return psMember(tenantId) && (
        psIsAlex() || psIsPatrick() || (psHasProfile() && "role" in psProfile() && psProfile().role == "admin")
      );
    }
    function psKindOk(kind) {
      return kind == "skid-steer" || kind == "excavator" || kind == "tip-truck"
        || kind == "ute" || kind == "trailer" || kind == "other-plant";
    }
    function psItem(item) {
      return item.keys().hasOnly(["id", "result", "comment", "critical"])
        && item.id is string
        && item.id.size() > 0
        && item.id.size() <= 40
        && (item.result == "pass" || item.result == "fail" || item.result == "na")
        && item.comment is string
        && item.comment.size() <= 500
        && (item.result != "fail" || item.comment.size() > 0)
        && item.critical is bool;
    }
    function psItems(items) {
      return items is list
        && items.size() >= 1
        && items.size() <= 16
        && psItem(items[0])
        && psItem(items[items.size() - 1]);
    }
    function psTpl(item) {
      return item.keys().hasOnly(["id", "label", "critical"])
        && item.id is string && item.id.size() > 0 && item.id.size() <= 40
        && item.label is string && item.label.size() > 0 && item.label.size() <= 60
        && item.critical is bool;
    }
    function psCreateOk() {
      return request.resource.data.keys().hasOnly(["assetId", "assetType", "assetName", "kind", "day", "reading", "readingUnit", "odometer", "items", "signerUid", "signerName", "signedAt", "defect", "doNotOperate", "resolved"])
        && request.resource.data.assetId is string
        && request.resource.data.assetId.matches('^[A-Za-z0-9_-]{1,80}$')
        && (request.resource.data.assetType == "vehicle" || request.resource.data.assetType == "trailer" || request.resource.data.assetType == "plant")
        && psKindOk(request.resource.data.kind)
        && request.resource.data.assetName is string
        && request.resource.data.assetName.size() > 0
        && request.resource.data.assetName.size() <= 80
        && request.resource.data.day is string
        && request.resource.data.day.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        && request.resource.data.reading is int
        && request.resource.data.reading >= 0
        && request.resource.data.reading <= 10000000
        && (request.resource.data.readingUnit == "" || request.resource.data.readingUnit == "hours" || request.resource.data.readingUnit == "km")
        && request.resource.data.odometer is int
        && request.resource.data.odometer >= 0
        && request.resource.data.odometer <= 10000000
        && psItems(request.resource.data.items)
        && request.resource.data.signerUid == request.auth.uid
        && request.resource.data.signerName is string
        && request.resource.data.signerName.size() >= 2
        && request.resource.data.signerName.size() <= 80
        && request.resource.data.signedAt == request.time
        && request.resource.data.defect is bool
        && request.resource.data.doNotOperate is bool
        && request.resource.data.resolved == false;
    }
    function psSame(key) {
      return request.resource.data[key] == resource.data[key];
    }
    function psResolveOk() {
      return resource.data.defect == true
        && resource.data.resolved == false
        && request.resource.data.resolved == true
        && request.resource.data.resolvedBy == request.auth.uid
        && request.resource.data.resolvedNote is string
        && request.resource.data.resolvedNote.size() <= 500
        && request.resource.data.resolvedAt == request.time
        && psSame("assetId") && psSame("assetType") && psSame("assetName") && psSame("kind")
        && psSame("day") && psSame("reading") && psSame("readingUnit") && psSame("odometer")
        && psSame("items") && psSame("signerUid") && psSame("signerName")
        && psSame("signedAt") && psSame("defect") && psSame("doNotOperate");
    }
    function psTemplateOk() {
      return request.resource.data.keys().hasOnly(["items", "updatedAt", "updatedBy"])
        && request.resource.data.items is list
        && request.resource.data.items.size() >= 1
        && request.resource.data.items.size() <= 16
        && psTpl(request.resource.data.items[0])
        && psTpl(request.resource.data.items[request.resource.data.items.size() - 1])
        && request.resource.data.updatedBy == request.auth.uid
        && request.resource.data.updatedAt == request.time;
    }

    match /tenants/{tenantId}/prestarts/{id} {
      allow read: if psMember(tenantId);
      allow create: if psMember(tenantId) && psCreateOk();
      allow update: if psAdmin(tenantId) && psResolveOk();
      allow delete: if false;
    }

    match /tenants/{tenantId}/prestartTemplates/{assetType} {
      allow read: if psMember(tenantId);
      allow create, update: if psAdmin(tenantId)
        && psKindOk(assetType)
        && psTemplateOk();
      allow delete: if false;
    }
// END PRESTART RULES
```

## Timesheet (#18)

### Added block: TIMESHEET

Paste inside `match /databases/{database}/documents`, after the FLEET and PRESTART blocks. Source: `cloud/production/firestore.timesheet.rules`. The emulator slice is identical.

This block also matches `tenants/{tenantId}/fleet/{assetId}` and `tenants/{tenantId}/prestarts/{id}` for read. `allow write: if false` in those matches does not remove the write allows from the FLEET and PRESTART blocks. Keep all three blocks.

```
// BEGIN TIMESHEET RULES
    function tsHeartwoodAdmin() {
      return isAlex() || isPatrick() || (
        hasProfile() && profile().role == "admin"
        && (!("tenantId" in profile()) || profile().tenantId == "heartwood")
      );
    }
    function tsMine(id) {
      return signedIn()
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.weekStart is string
        && request.resource.data.weekStart.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        && id == request.auth.uid + "_" + request.resource.data.weekStart;
    }
    function tsDocOk() {
      return request.resource.data.keys().hasOnly(["uid", "name", "weekStart", "weekEnd", "days", "entries", "totalHrs", "updatedAt", "updatedAtIso", "lastEntryId", "locationConsentAt", "sent", "sentAt", "sentBy"])
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 80
        && request.resource.data.weekEnd is string
        && request.resource.data.weekEnd >= request.resource.data.weekStart
        && request.resource.data.days is map
        && request.resource.data.days.size() <= 7
        && request.resource.data.totalHrs is number
        && request.resource.data.totalHrs >= 0
        && request.resource.data.totalHrs <= 400
        && request.resource.data.updatedAt == request.time
        && request.resource.data.updatedAtIso is string
        && request.resource.data.updatedAtIso.size() <= 40;
    }
    function tsFix(m) {
      return m.keys().hasOnly(["at", "fix", "lat", "lng", "accuracy"])
        && m.at == request.time
        && ((m.fix == "no location" && m.keys().hasOnly(["at", "fix"]))
          || (m.fix == "gps" && m.lat is number && m.lat >= -90 && m.lat <= 90
            && m.lng is number && m.lng >= -180 && m.lng <= 180
            && m.accuracy is number && m.accuracy >= 0 && m.accuracy <= 100000));
    }
    function tsFixSame(b, a, k) {
      return a.source == "manual" ? !(k in a)
        : ((!(k in a) && !(k in b)) || ((k in a) && (k in b) && a[k] == b[k]) || ((k in a) && !(k in b) && tsFix(a[k])));
    }
    function tsEntryCore(e) {
      return e.keys().hasOnly(["id", "source", "status", "date", "start", "finish", "breakStart", "breakEnd", "note", "job", "clockOn", "clockOff", "breakOn", "breakOff", "enteredBy", "enteredByName", "enteredAt", "edits", "lastEditId", "machineChoice", "machineId", "machineName"])
        && e.id == request.resource.data.lastEntryId
        && e.id.matches('^[a-z0-9]{8,24}$')
        && (e.source == "clock" || e.source == "manual")
        && e.enteredBy == request.auth.uid
        && e.enteredByName is string && e.enteredByName.size() > 0 && e.enteredByName.size() <= 80
        && e.enteredAt is timestamp
        && e.edits is map
        && e.note is string && e.note.size() <= 200
        && e.job is string && e.job.size() <= 200
        && e.date is string && e.date.size() == 10
        && e.start is string && e.start.size() <= 5
        && e.finish is string && e.finish.size() <= 5
        && ((e.source == "clock" && "clockOn" in e) || (e.source == "manual" && !e.keys().hasAny(["clockOn", "clockOff", "breakOn", "breakOff"])));
    }
    function tsEntryNew(e) {
      return tsEntryCore(e) && e.enteredAt == request.time && e.edits.size() == 0 && e.lastEditId == ""
        && tsFixSame({}, e, "clockOn") && tsFixSame({}, e, "clockOff") && tsFixSame({}, e, "breakOn") && tsFixSame({}, e, "breakOff");
    }
    function tsEditOk(b, a) {
      return a.edits.diff(b.edits).removedKeys().size() == 0
        && a.edits.diff(b.edits).changedKeys().size() == 0
        && (a.edits.diff(b.edits).addedKeys().size() == 0
          || (a.edits.diff(b.edits).addedKeys().hasOnly([a.lastEditId])
            && a.edits[a.lastEditId].at == request.time
            && a.edits[a.lastEditId].by == request.auth.uid
            && a.edits[a.lastEditId].byName is string
            && a.edits[a.lastEditId].summary is string
            && a.edits[a.lastEditId].summary.size() > 0
            && a.edits[a.lastEditId].summary.size() <= 200));
    }
    function tsMachineLock(b, a) {
      return (!("machineChoice" in a) && !("machineChoice" in b))
        || ("machineChoice" in b && a.machineChoice == b.machineChoice && a.get("machineId", "") == b.get("machineId", "") && a.get("machineName", "") == b.get("machineName", ""))
        || (!("machineChoice" in b) && (
          ((a.machineChoice == "none" || a.machineChoice == "skip") && a.machineId == "" && a.machineName is string && a.machineName.size() <= 80)
          || (a.machineChoice == "asset" && a.machineId.matches('^[A-Za-z0-9_-]{1,80}$') && a.machineName is string && a.machineName.size() > 0 && a.machineName.size() <= 80)
        ));
    }
    function tsEntryNext(b, a) {
      return tsEntryCore(a) && a.source == b.source && a.enteredBy == b.enteredBy && a.enteredAt == b.enteredAt && a.id == b.id
        && tsFixSame(b, a, "clockOn") && tsFixSame(b, a, "clockOff") && tsFixSame(b, a, "breakOn") && tsFixSame(b, a, "breakOff")
        && tsMachineLock(b, a)
        && tsEditOk(b, a);
    }
    function tsFleetReader(tenantId) {
      return signedIn()
        && tenantId is string
        && tenantId.matches('^[a-z0-9][a-z0-9-]{0,39}$')
        && (
          ((isAlex() || isPatrick()) && tenantId == "heartwood")
          || (hasProfile() && (
            ("tenantId" in profile() && profile().tenantId == tenantId)
            || (!("tenantId" in profile()) && tenantId == "heartwood")
          ))
        );
    }
    function tsOneEntry() {
      return request.resource.data.entries is map
        && request.resource.data.entries.size() <= 40
        && request.resource.data.lastEntryId is string
        && request.resource.data.entries.diff(resource.data.get("entries", {})).removedKeys().size() == 0
        && request.resource.data.entries.diff(resource.data.get("entries", {})).affectedKeys().size() == 1
        && request.resource.data.entries.diff(resource.data.get("entries", {})).affectedKeys().hasOnly([request.resource.data.lastEntryId])
        && (
          (request.resource.data.lastEntryId in resource.data.get("entries", {})
            && tsEntryNext(resource.data.entries[request.resource.data.lastEntryId], request.resource.data.entries[request.resource.data.lastEntryId]))
          || (!(request.resource.data.lastEntryId in resource.data.get("entries", {}))
            && tsEntryNew(request.resource.data.entries[request.resource.data.lastEntryId]))
        );
    }
    function tsWorkerCreate(id) {
      return tsMine(id) && tsDocOk()
        && !("sent" in request.resource.data) && !("sentAt" in request.resource.data) && !("sentBy" in request.resource.data)
        && (!("locationConsentAt" in request.resource.data) || request.resource.data.locationConsentAt == request.time)
        && (!("entries" in request.resource.data)
          || (request.resource.data.entries.size() == 1
            && request.resource.data.lastEntryId in request.resource.data.entries
            && tsEntryNew(request.resource.data.entries[request.resource.data.lastEntryId])));
    }
    function tsWorkerUpdate(id) {
      return tsMine(id) && tsDocOk()
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.weekStart == resource.data.weekStart
        && same("sent") && same("sentAt") && same("sentBy")
        && (!("locationConsentAt" in resource.data) && !("locationConsentAt" in request.resource.data)
          || !("locationConsentAt" in resource.data) && request.resource.data.locationConsentAt == request.time
          || request.resource.data.get("locationConsentAt", null) == resource.data.get("locationConsentAt", null))
        && (request.resource.data.get("entries", {}) == resource.data.get("entries", {}) || tsOneEntry());
    }
    function tsSentUpdate() {
      return tsHeartwoodAdmin()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["sent", "sentAt", "sentBy"])
        && request.resource.data.sent is bool
        && (request.resource.data.get("sentAt", null) == null || request.resource.data.sentAt is string)
        && (request.resource.data.get("sentBy", null) == null || request.resource.data.sentBy == request.auth.uid);
    }

    match /timesheets/{id} {
      allow read: if signedIn() && (
        tsHeartwoodAdmin()
        || (resource == null && id.matches('^' + request.auth.uid + '_[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
        || (resource != null && resource.data.uid == request.auth.uid)
      );
      allow create: if tsWorkerCreate(id);
      allow update: if tsWorkerUpdate(id) || tsSentUpdate();
      allow delete: if false;
    }

    // Read-only mirror so clock-on can list machines and today's prestart.
    // Creates and edits stay with the compliance PR. allow write: if false does not veto those rules.
    match /tenants/{tenantId}/fleet/{assetId} {
      allow read: if tsFleetReader(tenantId);
      allow write: if false;
    }
    match /tenants/{tenantId}/prestarts/{id} {
      allow read: if tsFleetReader(tenantId);
      allow write: if false;
    }
// END TIMESHEET RULES
```

## Helper (#17)

No Firestore rule blocks. `helperAsk` uses the Admin SDK, which bypasses rules. Do not add a client read or write rule for `helperProposals` or `helperAudit`. As of 8 Nov 2026 the callable returns before Confirm, Cancel, or Vertex. `HELPER_ENABLED` defaults to `false`, and `HELPER_HARD_OFF` ignores a `true` value. Existing rows stay. They do not need a new rules block.
