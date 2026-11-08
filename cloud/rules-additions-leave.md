# Leave rule additions

Paste these two blocks into the live rules for `heartwood-9f37f`. Do not deploy `cloud/emulator/firestore.rules` or `cloud/emulator/storage.rules`. Those files are the emulator model and would replace the rest of the live rules.

Live Firestore already has these helpers from the timesheet paste: `isAlex`, `isPatrick`, `hasProfile`, `profile`, `same`, `userPath`. The leave block uses those and defines every other function itself. It does not call `signedIn`, `isAppAdmin`, or the servicing, prestart, or invite helpers.

The certificate block does not call the Storage helpers. Alex and Patrick are named in the block. Any other admin is one `firestore.get` of `users/{uid}`. The staff member who uploaded the file is matched on the path and does not read Firestore. A supervisor is not an admin, so the file stays closed to them.

## Firestore

Paste inside `match /databases/{database}/documents`. Source: `cloud/production/firestore.leave.rules`. The emulator slice is identical.

```
// BEGIN LEAVE RULES
    function lvSignedIn() { return request.auth != null; }
    function lvHeartwood() {
      return lvSignedIn() && (
        isAlex() || isPatrick() || (
          hasProfile() && (!("tenantId" in profile()) || profile().tenantId == "heartwood")
        )
      );
    }
    function lvDecider() {
      return lvHeartwood() && (
        isAlex() || isPatrick() || (
          hasProfile() && (profile().role == "admin" || profile().role == "supervisor")
        )
      );
    }
    function lvDate(v) {
      return v is string && v.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    }
    function lvHalf(v) {
      return v == "" || v == "am" || v == "pm";
    }
    function lvHalves() {
      return lvHalf(request.resource.data.startHalf)
        && lvHalf(request.resource.data.endHalf)
        && (
          (request.resource.data.start == request.resource.data.end
            && request.resource.data.startHalf == request.resource.data.endHalf)
          || (request.resource.data.start < request.resource.data.end
            && (request.resource.data.startHalf == "" || request.resource.data.startHalf == "pm")
            && (request.resource.data.endHalf == "" || request.resource.data.endHalf == "am"))
        );
    }
    function lvCertPath(uid, id) {
      return request.resource.data.certificatePath == ""
        || request.resource.data.certificatePath == "leaveCertificates/" + uid + "/" + id + "/cert.pdf"
        || request.resource.data.certificatePath == "leaveCertificates/" + uid + "/" + id + "/cert.jpg"
        || request.resource.data.certificatePath == "leaveCertificates/" + uid + "/" + id + "/cert.png"
        || request.resource.data.certificatePath == "leaveCertificates/" + uid + "/" + id + "/cert.webp";
    }
    function lvCreate(id) {
      return lvHeartwood()
        && id.matches('^lv[a-z0-9]{16}$')
        && request.resource.data.keys().hasOnly(["uid", "name", "type", "start", "end", "startHalf", "endHalf", "reason", "certificatePath", "certificateName", "status", "decisionNote", "decidedBy", "decidedByName", "decidedAt", "createdAt", "updatedAt"])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 80
        && (request.resource.data.type == "annual" || request.resource.data.type == "sick" || request.resource.data.type == "other")
        && lvDate(request.resource.data.start)
        && lvDate(request.resource.data.end)
        && request.resource.data.end >= request.resource.data.start
        && lvHalves()
        && request.resource.data.reason is string
        && request.resource.data.reason.size() > 0
        && request.resource.data.reason.size() <= 500
        && lvCertPath(request.auth.uid, id)
        && request.resource.data.certificateName is string
        && request.resource.data.certificateName.size() <= 120
        && (request.resource.data.certificatePath == ""
          ? request.resource.data.certificateName == ""
          : request.resource.data.certificateName.size() > 0)
        && request.resource.data.status == "pending"
        && request.resource.data.decisionNote == ""
        && request.resource.data.decidedBy == ""
        && request.resource.data.decidedByName == ""
        && request.resource.data.decidedAt == null
        && request.resource.data.createdAt == request.time
        && request.resource.data.updatedAt == request.time;
    }
    function lvDecision() {
      return lvDecider()
        && resource.data.status == "pending"
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["status", "decisionNote", "decidedBy", "decidedByName", "decidedAt", "updatedAt"])
        && (request.resource.data.status == "approved" || request.resource.data.status == "declined")
        && request.resource.data.decisionNote is string
        && request.resource.data.decisionNote.size() > 0
        && request.resource.data.decisionNote.size() <= 500
        && request.resource.data.decidedBy == request.auth.uid
        && request.resource.data.decidedByName is string
        && request.resource.data.decidedByName.size() > 0
        && request.resource.data.decidedByName.size() <= 80
        && request.resource.data.decidedAt == request.time
        && request.resource.data.updatedAt == request.time
        && same("uid") && same("name") && same("type") && same("start") && same("end")
        && same("startHalf") && same("endHalf") && same("reason")
        && same("certificatePath") && same("certificateName") && same("createdAt");
    }

    match /leaveRequests/{id} {
      allow read: if lvHeartwood() && (
        lvDecider()
        || (resource != null && resource.data.uid == request.auth.uid)
        || (resource == null && id.matches('^lv[a-z0-9]{16}$'))
      );
      allow create: if lvCreate(id);
      allow update: if lvDecision();
      allow delete: if false;
    }
// END LEAVE RULES
```

## Storage

Paste inside `match /b/{bucket}/o`. Source: `cloud/production/storage.leave.rules`. The same bytes are in `cloud/emulator/storage.rules` and `cloud/production/storage.rules`.

```
// BEGIN LEAVE CERTIFICATE RULES
    function lvCertSignedIn() { return request.auth != null; }
    function lvCertIsAlex() { return lvCertSignedIn() && request.auth.uid == "1JKLsoxkQNfkphBBO0vDz2ziEyj2"; }
    function lvCertIsPatrick() { return lvCertSignedIn() && request.auth.uid == "R7t41e54Ykcdk9WPdVZnDd697iI2"; }
    function lvCertUserPath() { return /databases/(default)/documents/users/$(request.auth.uid); }
    function lvCertAdmin() {
      return lvCertIsAlex() || lvCertIsPatrick() || (
        lvCertSignedIn() && firestore.get(lvCertUserPath()).data.get("role", "") == "admin"
      );
    }
    function lvCertFile(uid, requestId, file) {
      return request.auth.uid == uid
        && requestId.matches('^lv[a-z0-9]{16}$')
        && request.resource.size > 0
        && request.resource.size <= 8 * 1024 * 1024
        && request.resource.metadata.purpose == "leave-certificate"
        && request.resource.metadata.uploaderUid == request.auth.uid
        && request.resource.metadata.requestId == requestId
        && (
          (file == "cert.pdf" && request.resource.contentType == "application/pdf")
          || (file == "cert.jpg" && request.resource.contentType == "image/jpeg")
          || (file == "cert.png" && request.resource.contentType == "image/png")
          || (file == "cert.webp" && request.resource.contentType == "image/webp")
        );
    }
    function lvCertReader(uid) {
      return lvCertSignedIn() && (request.auth.uid == uid || lvCertAdmin());
    }

    match /leaveCertificates/{uid}/{requestId} {
      allow list: if lvCertReader(uid);
    }
    match /leaveCertificates/{uid}/{requestId}/{file} {
      allow read: if lvCertReader(uid);
      allow create: if lvCertSignedIn() && lvCertFile(uid, requestId, file);
      allow update, delete: if false;
    }
// END LEAVE CERTIFICATE RULES
```
