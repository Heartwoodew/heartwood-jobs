#!/usr/bin/env python3
"""Measure Firestore rules compiler scope.

scopeWeight is the sum, over every match, of how many functions that match can
see. The production rules compiler walks that scope tree recursively; a 503
from rulesets:test is what it returns when the walk runs out of stack.
rootFunctions are the helpers defined on the database match, which every
collection used to inherit. maxCallDepth is the longest helper call chain.
"""
import json
import re
import sys
from collections import defaultdict

path = sys.argv[1]
src = open(path).read()

def strip_comments_strings(s):
    out = []
    i = 0
    n = len(s)
    while i < n:
        if s[i:i+2] == "//":
            j = s.find("\n", i)
            if j < 0:
                j = n
            out.append(" " * (j - i))
            i = j
            continue
        if s[i] == "'":
            j = i + 1
            while j < n and s[j] != "'":
                if s[j] == "\\":
                    j += 2
                    continue
                j += 1
            j = min(j + 1, n)
            out.append(" " * (j - i))
            i = j
            continue
        out.append(s[i])
        i += 1
    return "".join(out)

# Find functions and matches with brace matching on raw source (strings/comments ignored for braces)
def scan_blocks(s):
    masked = strip_comments_strings(s)
    # token positions of function and match
    fun_re = re.compile(r"\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
    events = []
    for m in fun_re.finditer(masked):
        events.append((m.start(), "fun", m.group(1), m.end()))
    # match headers contain {wildcards}; the block brace is the '{' that is not a path param.
    i = 0
    while True:
        m = re.search(r"\bmatch\b", masked[i:])
        if not m:
            break
        start = i + m.start()
        j = i + m.end()
        block = None
        path_start = j
        while j < len(masked):
            if masked[j] == "{":
                k = masked.find("}", j + 1)
                content = masked[j + 1:k] if k > 0 else ""
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(?:=[A-Za-z0-9_*]+)?", content or ""):
                    nxt = k + 1
                    while nxt < len(masked) and masked[nxt].isspace():
                        nxt += 1
                    if nxt < len(masked) and masked[nxt] == "/":
                        j = k + 1
                        continue
                    if nxt < len(masked) and masked[nxt] == "{":
                        block = nxt
                        path = masked[path_start:j].strip() + masked[j:k + 1]
                        break
                block = j
                path = masked[path_start:j].strip()
                break
            j += 1
        if block is None:
            break
        path = re.sub(r"\s+", "", path)
        events.append((start, "match", path, block))
        i = block + 1
    events.sort()
    # brace walk to get end of each
    blocks = []
    for pos, kind, name, brace_at in events:
        if kind == "fun":
            # find '{' after signature
            b = masked.find("{", brace_at - 1)
            depth = 0
            i = b
            while i < len(masked):
                if masked[i] == "{":
                    depth += 1
                elif masked[i] == "}":
                    depth -= 1
                    if depth == 0:
                        blocks.append({"kind": "fun", "name": name, "start": pos, "end": i + 1, "body_start": b + 1, "body_end": i})
                        break
                i += 1
        else:
            b = brace_at
            depth = 0
            i = b
            while i < len(masked):
                if masked[i] == "{":
                    depth += 1
                elif masked[i] == "}":
                    depth -= 1
                    if depth == 0:
                        blocks.append({"kind": "match", "name": name, "start": pos, "end": i + 1, "body_start": b + 1, "body_end": i})
                        break
                i += 1
    return blocks

blocks = scan_blocks(src)
funs = [b for b in blocks if b["kind"] == "fun"]
matches = [b for b in blocks if b["kind"] == "match"]
# parent: innermost block that contains start
def parent_of(b):
    cands = [o for o in blocks if o is not b and o["start"] < b["start"] and o["end"] > b["end"]]
    if not cands:
        return None
    return min(cands, key=lambda o: o["end"] - o["start"])

for b in blocks:
    b["parent"] = parent_of(b)

names = [f["name"] for f in funs]
name_set = set(names)
dups = [n for n in names if names.count(n) > 1]

call_re = re.compile(r"(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)\s*\(")
builtins = {"if", "return", "function", "match", "allow", "exists", "get", "getAfter", "existsAfter",
            "string", "int", "float", "bool", "list", "map", "null", "duration", "timestamp", "path",
            "latlng", "number", "request", "resource", "debug", "math"}

def calls_in(text):
    masked = strip_comments_strings(text)
    found = []
    for m in call_re.finditer(masked):
        n = m.group(1)
        if n in name_set and n not in builtins:
            found.append(n)
    return found

# direct calls per function
calls = {}
for f in funs:
    body = src[f["body_start"]:f["body_end"]]
    calls[id(f)] = calls_in(body)
    f["calls"] = calls[id(f)]

# match direct calls from allow lines: body minus nested blocks
def direct_text(block):
    # remove nested block ranges
    nested = [b for b in blocks if b["parent"] is block]
    segs = []
    cursor = block["body_start"]
    for n in sorted(nested, key=lambda b: b["start"]):
        segs.append(src[cursor:n["start"]])
        cursor = n["end"]
    segs.append(src[cursor:block["body_end"]])
    return "".join(segs)

for m in matches:
    m["direct_calls"] = calls_in(direct_text(m))
    m["depth"] = 0
    p = m["parent"]
    while p and p["kind"] == "match":
        m["depth"] += 1
        p = p["parent"]

# database-scope functions: parent is the /databases match
db = [m for m in matches if m["name"].startswith("/databases/")]
assert len(db) == 1, len(db)
db = db[0]

def scope_match(f):
    p = f["parent"]
    if p is db or p is None:
        return None  # root of database
    # climb to nearest match
    while p and p["kind"] != "match":
        p = p["parent"]
    return p

root_funs = [f for f in funs if scope_match(f) is None]
inner_funs = [f for f in funs if scope_match(f) is not None]

# which matches need each root function, propagated
# index functions by name at root (unique)
by_name = {}
for f in funs:
    by_name.setdefault(f["name"], []).append(f)

# For root functions only, compute need sets.
# A match needs a function if its direct calls include it, or a function it needs calls it,
# considering only root functions (inner functions are already scoped).

root_names = {f["name"] for f in root_funs}
# calls from root function name -> names
root_calls = defaultdict(set)
for f in root_funs:
    for c in f["calls"]:
        if c in root_names:
            root_calls[f["name"]].add(c)

# direct match needs
match_direct = {}
for i, m in enumerate(matches):
    if m is db:
        continue
    match_direct[i] = {c for c in m["direct_calls"] if c in root_names}
    # also calls from inner functions of this match (they can see root)
    for f in funs:
        sm = scope_match(f)
        if sm is m:
            for c in f["calls"]:
                if c in root_names and c != f["name"]:
                    match_direct[i].add(c)

need = defaultdict(set)  # name -> match indexes
for i, nameset in match_direct.items():
    for n in nameset:
        need[n].add(i)

# propagate along root call graph: if match needs G and G calls F, match needs F
changed = True
while changed:
    changed = False
    for g, fs in root_calls.items():
        for f in fs:
            before = len(need[f])
            need[f] |= need[g]
            if len(need[f]) != before:
                changed = True

# also functions only called from other root functions
dead = []
reachable = set()
# seed reachable from any match direct or inner
for n, s in need.items():
    if s:
        reachable.add(n)
# also seed from db direct? none
changed = True
while changed:
    changed = False
    for g in list(reachable):
        for f in root_calls[g]:
            if f not in reachable:
                reachable.add(f)
                changed = True

for f in root_funs:
    if f["name"] not in reachable and not need[f["name"]]:
        dead.append(f["name"])

# call depth
depth_memo = {}
def call_depth(name, stack):
    if name in depth_memo and name not in stack:
        return depth_memo[name]
    if name in stack:
        return 10**6  # cycle
    stack.add(name)
    ds = [1]
    # all defs
    for f in by_name.get(name, []):
        for c in f["calls"]:
            if c in name_set:
                ds.append(1 + call_depth(c, stack))
    stack.remove(name)
    depth_memo[name] = max(ds)
    return depth_memo[name]

max_depth = 0
deepest = []
for n in name_set:
    d = call_depth(n, set())
    if d > max_depth and d < 10**5:
        max_depth = d
    if 10**5 > d >= 8:
        deepest.append((d, n))

# scope weight: for each non-db match, functions visible = root live + functions in ancestor matches + self
live_root = len(root_funs) - len(set(dead))
weight = 0
max_visible = 0
match_nest = 0
for m in matches:
    if m is db:
        continue
    match_nest = max(match_nest, m["depth"])
    vis = live_root
    # inner functions in this match and ancestors
    p = m
    while p and p is not db:
        vis += sum(1 for f in funs if scope_match(f) is p)
        p = p["parent"] if p["parent"] and p["parent"]["kind"] == "match" else None
        if p is None:
            break
    weight += vis
    max_visible = max(max_visible, vis)

# histogram of need sizes
hist = defaultdict(int)
for f in root_funs:
    if f["name"] in dead:
        hist["dead"] += 1
    else:
        hist[len(need[f["name"]])] += 1

report = {
    "bytes": len(src.encode()),
    "functions": len(funs),
    "rootFunctions": len(root_funs),
    "innerFunctions": len(inner_funs),
    "matches": len(matches) - 1,
    "maxMatchNesting": match_nest,
    "maxCallDepth": max_depth,
    "scopeWeight": weight,
    "maxFunctionsVisible": max_visible,
    "dead": sorted(set(dead)),
}
print(json.dumps(report, indent=2))
