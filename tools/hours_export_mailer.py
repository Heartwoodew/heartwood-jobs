#!/usr/bin/env python3
"""Hours spreadsheet mailer. Sends nothing itself.

Heartwood exports still go only to accounts@heartwoodew.com, with the same subject and body.
Another company's export goes to that company's accountsEmail (hoursExports.to). It is refused
if that address is Heartwood's mailbox or is not a normal email.

The app uploads the .xlsx to private Storage (hoursExports/<id>/<file>.xlsx) and writes
hoursExports/<id> with status "queued".
The box cannot reach SMTP, so an agent routine sends with the Gmail connector (alex@heartwoodew.com):
  1. hours_export_mailer.py pending --out DIR  -> JSON list of emails to send; each is locked as "sending".
  2. For each item: Gmail send_email to item["to"], one email per item, subject/body from the item,
     attach item["filename"] (mimeType item["mimeType"], base64 content in item["attachmentB64File"]).
  3. hours_export_mailer.py mark ID sent MESSAGE_ID   (or: mark ID failed "reason" -> retried next run, max 5 tries)
Items left "sending" for >30 min come back with "verify": true; search Gmail with item["verifyQuery"] first.
If found, mark sent with that message id; otherwise send. That keeps it to one email per export.
No deletes anywhere.
"""
import base64, datetime as dt, json, os, re, sys, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get("HWFIRE_DIR", "/workspace/heartwood-app/tools"))
import hwfire  # noqa: E402
from company_scope import hours_recipient, hours_subject  # noqa: E402

TO = "accounts@heartwoodew.com"
MAX_TRIES = 5
STALE = dt.timedelta(minutes=30)
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ID_RE = r"hx[a-z0-9]{16}"


def now(): return dt.datetime.now(dt.timezone.utc)
def iso(): return now().isoformat().replace("+00:00", "Z")
def parse(t):
    try: return dt.datetime.fromisoformat(str(t).replace("Z", "+00:00"))
    except Exception: return None
def dmy(s): return f"{s[8:10]}/{s[5:7]}/{s[0:4]}" if s and len(s) >= 10 else ""


def storage_get(c, path):
    bucket = os.environ.get("HW_BUCKET", "heartwood-9f37f.firebasestorage.app")
    url = f"https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{urllib.parse.quote(path, safe='')}?alt=media"
    req = urllib.request.Request(url, headers={"Authorization": "Firebase " + c.token()})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read()


def recipient(d):
    return hours_recipient(d)


def due(d):
    """(due, verify)"""
    st = d.get("status") or ""
    if st == "sent": return False, False
    ok, _to, _name = recipient(d)
    if not ok: return False, False
    if int(d.get("attempts") or 0) >= MAX_TRIES and st != "sending": return False, False
    if st == "sending":
        t = parse(d.get("updatedAt"))
        return (t is None or now() - t > STALE), True
    return st in ("queued", "failed"), False


def update(c, id_, data):
    b = c.batch(); b.update(f"hoursExports/{id_}", data); b.commit()


def pending(out):
    c = hwfire.connect(); c = c[0] if isinstance(c, tuple) else c
    os.makedirs(out, exist_ok=True); items = []
    for st in ("queued", "failed", "sending"):
        for id_, d in c.where("hoursExports", "status", "==", st):
            if not re.fullmatch(ID_RE, id_): continue
            ok, verify = due(d)
            if not ok: continue
            path, name = d.get("storagePath") or "", d.get("fileName") or ""
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}\.xlsx", name) or path != f"hoursExports/{id_}/{name}":
                update(c, id_, {"status": "failed", "attempts": MAX_TRIES, "error": "bad file path", "updatedAt": iso()}); continue
            tries = int(d.get("attempts") or 0)
            try: data = storage_get(c, path)
            except Exception as e:
                update(c, id_, {"status": "failed", "attempts": tries + 1, "error": f"download: {e}"[:300], "updatedAt": iso()}); continue
            fpath = os.path.join(out, f"{id_}_{name}")
            with open(fpath, "wb") as f: f.write(data)
            with open(fpath + ".b64", "w") as f: f.write(base64.b64encode(data).decode())
            ws, we = d.get("weekStart", ""), d.get("weekEnd", "")
            ok_to, to, subject_name = recipient(d)
            if not ok_to: continue
            tag = f"[HWH {id_[2:10]}]"
            subject = hours_subject(subject_name, dmy(ws), dmy(we), tag)
            if subject_name == "Heartwood":
                body = (f"Hi Nicole,\n\nAttached are the timesheet hours for Mon {dmy(ws)} to Sun {dmy(we)} "
                        f"({d.get('people', 0)} staff, {float(d.get('totalHours') or 0):.2f} hours total).\n"
                        "The Summary sheet has each person's total and any leave; the Detail sheet has every shift.\n\n"
                        "Thanks,\nAlex\nHeartwood")
            else:
                subject = f"Timesheet hours {dmy(ws)} to {dmy(we)} - {subject_name} {tag}"
                body = (f"Hi,\n\nAttached are the timesheet hours for Mon {dmy(ws)} to Sun {dmy(we)} "
                        f"({d.get('people', 0)} staff, {float(d.get('totalHours') or 0):.2f} hours total).\n"
                        "The Summary sheet has each person's total and any leave; the Detail sheet has every shift.\n\n"
                        f"Thanks,\n{subject_name}\n")
            items.append({"key": id_, "to": to, "subject": subject, "body": body, "filename": name, "mimeType": MIME,
                          "attachmentB64File": fpath + ".b64", "attachmentFile": fpath, "verify": verify,
                          "verifyQuery": f'to:{to} subject:"{tag[1:-1]}" in:sent'})
            update(c, id_, {"status": "sending", "attempts": tries + (0 if verify else 1), "updatedAt": iso()})
    print(json.dumps(items, indent=1))


def mark(id_, status, extra):
    if status not in ("sent", "failed") or not re.fullmatch(ID_RE, id_): sys.exit("usage: mark hx<id> sent <msgId>|failed <reason>")
    c = hwfire.connect(); c = c[0] if isinstance(c, tuple) else c
    d = c.get(f"hoursExports/{id_}") or {}
    ok_to, to, _name = recipient(d)
    if not ok_to: sys.exit("refusing: recipient is not that company's accounts email")
    if status == "sent":
        update(c, id_, {"status": "sent", "sentAt": iso(), "messageId": extra[:100], "via": "gmail-connector", "error": "", "updatedAt": iso()})
    else:
        update(c, id_, {"status": "failed", "error": extra[:300], "updatedAt": iso()})
    print("ok", id_, status)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["pending"]: pending(a[a.index("--out") + 1] if "--out" in a else "/workspace/hours-outbox")
    elif a[:1] == ["mark"] and len(a) >= 4: mark(a[1], a[2], " ".join(a[3:]))
    else: sys.exit(__doc__)
