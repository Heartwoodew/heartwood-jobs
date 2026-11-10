#!/usr/bin/env python3
"""Hubdoc filer for paid reimbursements. Sends nothing itself.

The box cannot reach SMTP, so an agent routine sends with the Gmail connector (alex@heartwoodew.com):
  1. hubdoc_filer.py pending --out DIR   -> JSON list of receipts to email; each is locked as "sending".
                                            Paid claims with no receipt are marked "no-receipt" (nothing sent).
  2. For each item: Gmail send_email to item["to"] (always ownerSettings/hubdoc.email, *@app.hubdoc.com only),
     one email per item, subject/body/attachment from the item.
  3. hubdoc_filer.py mark ID sent MESSAGE_ID     (or: mark ID failed "reason" -> retried next run, max 5 tries)
Items left "sending" for >30 min come back with "verify": true; the routine must search Gmail sent mail for
the item's subject tag before resending, then mark sent with the found id or resend. That keeps it to one send.

Covers both sources:
  claim:<id>   reimbursementClaims with status "paid" (hubdocStatus missing/queued/failed). Receipt from Storage.
  coclaim:<company>/<id>  another company's paid claim (companies/<company>/reimbursementClaims). Only when that
               company has its own hubdocAddress set (and is not a test company); it goes to that address only.
  legacy:<rid> old receipts ledger: reimbursements/<rid>.paid == true and receipts/<rid>.status == "queued".
               On sent: receipts/<rid> -> status "filed" so receipts_worker never files it again. Chunks are kept.
No deletes anywhere.
"""
import base64, datetime as dt, json, os, re, sys, urllib.parse, urllib.request
sys.path.insert(0, os.environ.get("HWFIRE_DIR", "/workspace/heartwood-app/tools"))
import hwfire  # noqa: E402

MAX_TRIES = 5
STALE = dt.timedelta(minutes=30)
MIME = {"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def now(): return dt.datetime.now(dt.timezone.utc)
def iso(): return now().isoformat().replace("+00:00", "Z")
def parse(t):
    try: return dt.datetime.fromisoformat(str(t).replace("Z", "+00:00"))
    except Exception: return None
def slug(s): return re.sub(r"[^A-Za-z0-9]+", "-", str(s or "")).strip("-")[:40] or "receipt"
def money(c): return f"${int(c or 0) / 100:,.2f}"


def hub_address(c):
    hub = ((c.get("ownerSettings/hubdoc") or {}).get("email") or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9._+-]+@app\.hubdoc\.com", hub): sys.exit("ownerSettings/hubdoc.email is not a Hubdoc address")
    return hub


def company_of(d):
    cid = (d.get("companyId") or d.get("tenantId") or "heartwood").strip() or "heartwood"
    return cid


def company_doc(c, cid):
    if cid == "heartwood": return {}
    return c.get(f"companies/{cid}") or {}


def hub_for(c, d, heartwood_hub):
    """Heartwood keeps ownerSettings/hubdoc. Another company uses its own hubdocAddress, or is skipped.
    Test companies are not filed."""
    if d.get("isTest") is True: return "", "Test"
    cid = company_of(d)
    if cid == "heartwood": return heartwood_hub, "Heartwood"
    comp = company_doc(c, cid)
    if comp.get("isTest") is True: return "", (comp.get("name") or "Test")
    hub = (comp.get("hubdocAddress") or "").strip().lower()
    name = (comp.get("name") or "Company").strip() or "Company"
    if not re.fullmatch(r"[a-z0-9._+-]+@app\.hubdoc\.com", hub): return "", name
    return hub, name


def where_in(c, parent, coll, field, value):
    """Equality query on a subcollection (parent like companies/acme)."""
    q = {"structuredQuery": {"from": [{"collectionId": coll}],
                             "where": {"fieldFilter": {"field": {"fieldPath": field}, "op": "EQUAL", "value": hwfire.enc(value)}}}}
    res = hwfire._http("POST", f"{c.fs_base}/{c.root}/{parent}:runQuery", q, token=c.token())
    return [(r["document"]["name"].rsplit("/", 1)[1], {k: hwfire.dec(v) for k, v in r["document"].get("fields", {}).items()})
            for r in res if "document" in r]


def company_hubs(c):
    """[(companyId, hubdoc address, name)] for other companies that set their own Hubdoc address."""
    out = []
    try: comps = c.list("companies")
    except hwfire.FirestoreError as e:
        print("companies not readable, other companies skipped:", str(e)[:120], file=sys.stderr); return out
    for cid, comp in comps:
        if cid == "heartwood" or comp.get("isTest") is True: continue
        hub = (comp.get("hubdocAddress") or "").strip().lower()
        if re.fullmatch(r"[a-z0-9._+-]+@app\.hubdoc\.com", hub): out.append((cid, hub, (comp.get("name") or "Company").strip() or "Company"))
    return out


def claim_item(c, out, key, path, d, dest, brand, verify, cid):
    if not d.get("receiptPath"):
        b = c.batch(); b.update(path, {"hubdocStatus": "no-receipt", "hubdocUpdatedAt": iso()}); b.commit(); return None
    ext = d["receiptPath"].rsplit(".", 1)[-1]
    name = f"receipt_{d.get('date', '')}_{slug(d.get('supplier'))}_{slug(d.get('name'))}_{cid}.{ext}"
    try: data = storage_get(c, d["receiptPath"])
    except Exception as e:
        mark_doc(c, path, "failed", err=f"download: {e}"[:300], d=d); return None
    via = "Heartwood jobs app" if brand == "Heartwood" else f"{brand} jobs app"
    it = item(out, key, dest, name, MIME[ext], data, verify,
              f"Receipt {d.get('supplier', '')} {d.get('date', '')} - {d.get('name', '')} [HW {cid}]",
              f"Reimbursement claim paid via {via}.\nStaff: {d.get('name', '')}\nSupplier: {d.get('supplier', '')}\n"
              f"Date: {d.get('date', '')}\nAmount: {money(d.get('amountCents'))} inc GST\nCategory: {d.get('category', '')}\n"
              + (f"Job: {d.get('jobLabel')}\n" if d.get("jobLabel") else "") + f"Ref: {cid}")
    lock(c, path, d, verify)
    return it


def storage_get(c, path):
    bucket = os.environ.get("HW_BUCKET", "heartwood-9f37f.firebasestorage.app")
    url = f"https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{urllib.parse.quote(path, safe='')}?alt=media"
    req = urllib.request.Request(url, headers={"Authorization": "Firebase " + c.token()})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read()


def due(d):
    """(due, verify) for a doc's hubdoc state."""
    st = d.get("hubdocStatus") or ""
    if st in ("sent", "filed", "no-receipt"): return False, False
    if int(d.get("hubdocAttempts") or 0) >= MAX_TRIES and st != "sending": return False, False
    if st == "sending":
        t = parse(d.get("hubdocUpdatedAt"))
        return (t is None or now() - t > STALE), True
    return True, False


def pending(out):
    c = hwfire.connect(); c = c[0] if isinstance(c, tuple) else c
    hub = hub_address(c); os.makedirs(out, exist_ok=True); items = []
    for cid, d in c.where("reimbursementClaims", "status", "==", "paid"):
        ok, verify = due(d)
        if not ok: continue
        dest, brand = hub_for(c, d, hub)
        if not dest: continue
        it = claim_item(c, out, "claim:" + cid, f"reimbursementClaims/{cid}", d, dest, brand, verify, cid)
        if it: items.append(it)
    for co, dest, brand in company_hubs(c):
        for cid, d in where_in(c, f"companies/{co}", "reimbursementClaims", "status", "paid"):
            ok, verify = due(d)
            if not ok: continue
            it = claim_item(c, out, f"coclaim:{co}/{cid}", f"companies/{co}/reimbursementClaims/{cid}", d, dest, brand, verify, cid)
            if it: items.append(it)
    for rid, led in c.where("reimbursements", "paid", "==", True):
        r = c.get(f"receipts/{rid}") or {}
        if r.get("status") != "queued": continue
        ok, verify = due(r)
        if not ok: continue
        dest, brand = hub_for(c, r, hub)
        if not dest: continue
        via = "Heartwood jobs app" if brand == "Heartwood" else f"{brand} jobs app"
        chunks = sorted(((x.get("i", 0), x.get("data", "")) for _, x in c.where("receiptChunks", "rid", "==", rid)))
        if len(chunks) != r.get("chunks", 0): continue
        data = base64.b64decode("".join(x for _, x in chunks))
        who, sup, job = r.get("byName") or led.get("byName") or "", r.get("supplier") or led.get("supplier") or "", r.get("jobNo") or led.get("jobNo") or ""
        amt = led.get("amountInc") or r.get("amountInc") or ""
        items.append(item(out, "legacy:" + rid, dest, f"receipt_{slug(sup)}_{slug(who)}_{rid}.jpg", "image/jpeg", data, verify,
                          f"Receipt {sup} job #{job} - {who} [HW {rid}]",
                          f"Uploaded by {who} via {via}. Amount ${amt} inc GST.\nRef: {rid}"))
        lock(c, f"receipts/{rid}", r, verify)
    print(json.dumps(items, indent=1))


def item(out, key, hub, name, mime, data, verify, subject, body):
    path = os.path.join(out, name)
    with open(path, "wb") as f: f.write(data)
    with open(path + ".b64", "w") as f: f.write(base64.b64encode(data).decode())
    return {"key": key, "to": hub, "subject": subject, "body": body, "filename": name, "mimeType": mime,
            "attachmentB64File": path + ".b64", "verify": verify,
            "verifyQuery": f'to:{hub} subject:"{subject.rsplit("[", 1)[-1].rstrip("]")}" in:sent'}


def lock(c, path, d, verify):
    tries = int(d.get("hubdocAttempts") or 0) + (0 if verify else 1)
    b = c.batch(); b.update(path, {"hubdocStatus": "sending", "hubdocAttempts": tries, "hubdocUpdatedAt": iso()}); b.commit()


def mark_doc(c, path, status, msg="", err="", d=None):
    data = {"hubdocStatus": status, "hubdocUpdatedAt": iso()}
    if status == "sent": data.update(hubdocSentAt=iso(), hubdocMessageId=msg, hubdocVia="gmail-connector", hubdocError="")
    if status == "failed": data.update(hubdocError=err[:300], hubdocAttempts=int((d or {}).get("hubdocAttempts") or 0) + (0 if d is None else 1))
    b = c.batch(); b.update(path, data); b.commit()


def mark(key, status, extra):
    c = hwfire.connect(); c = c[0] if isinstance(c, tuple) else c
    kind, _, id_ = key.partition(":")
    co = ""
    if kind == "coclaim": co, _, id_ = id_.partition("/")
    if (status not in ("sent", "failed") or kind not in ("claim", "coclaim", "legacy") or not re.fullmatch(r"[A-Za-z0-9_-]{6,40}", id_)
            or (kind == "coclaim" and (co == "heartwood" or not re.fullmatch(r"[a-z0-9-]{2,60}", co)))):
        sys.exit("usage: mark claim:<id>|coclaim:<company>/<id>|legacy:<rid> sent <msgId>|failed <reason>")
    if kind in ("claim", "coclaim"):
        path = f"reimbursementClaims/{id_}" if kind == "claim" else f"companies/{co}/reimbursementClaims/{id_}"
        mark_doc(c, path, status, msg=extra if status == "sent" else "", err=extra if status == "failed" else "")
    else:
        b = c.batch()
        if status == "sent":
            b.update(f"receipts/{id_}", {"status": "filed", "filedAt": hwfire.SERVER_TIMESTAMP, "hubdocStatus": "sent", "hubdocVia": "gmail-connector", "hubdocMessageId": extra, "hubdocUpdatedAt": iso()})
            b.update(f"reimbursements/{id_}", {"hubdocStatus": "filed"})
        else:
            b.update(f"receipts/{id_}", {"hubdocStatus": "failed", "hubdocError": extra[:300], "hubdocUpdatedAt": iso()})
        b.commit()
    print("ok", key, status)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["pending"]: pending(a[a.index("--out") + 1] if "--out" in a else "/workspace/hubdoc-outbox")
    elif a[:1] == ["mark"] and len(a) >= 4: mark(a[1], a[2], " ".join(a[3:]))
    else: sys.exit(__doc__)
