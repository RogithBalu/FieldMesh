#!/usr/bin/env python3
"""adb UI driver used for on-device testing of FieldMesh.
usage: adb-ui.py dump | find <q> | tap <q> [idx] | wait <q> [secs] | type <text> | back | home | hidekb | shot <path.png>
query: id:<resource-id> | text:<substring> | exact:<text> | desc:<content-desc substring>"""
import subprocess, sys, re, time, xml.etree.ElementTree as ET, os, tempfile
TMP = tempfile.gettempdir()
APP_PKGS = ("host.exp.exponent", "com.fieldmesh.inspect")
def sh(*a, check=True, capture=True):
    return subprocess.run(a, check=check, capture_output=capture, text=True).stdout
def dump():
    for _ in range(3):
        sh("adb", "shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False)
        sh("adb", "pull", "/sdcard/ui.xml", f"{TMP}/fm-ui.xml", check=False)
        try:
            return ET.parse(f"{TMP}/fm-ui.xml").getroot()
        except Exception:
            time.sleep(0.6)
    raise SystemExit("could not dump UI")
def bounds(n):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
    return tuple(map(int, m.groups())) if m else None
def matches(n, q):
    kind, _, val = q.partition(":")
    if kind == "id": return n.get("resource-id") == val
    if kind == "text": return val.lower() in (n.get("text") or "").lower()
    if kind == "exact": return (n.get("text") or "").strip() == val
    if kind == "desc": return val.lower() in (n.get("content-desc") or "").lower()
    return False
def find(q):
    return [n for n in dump().iter("node") if matches(n, q) and bounds(n)]
def center(n):
    x1, y1, x2, y2 = bounds(n); return (x1 + x2) // 2, (y1 + y2) // 2
def dismiss_overlays(root):
    for n in root.iter("node"):
        if (n.get("text") or "") == "Dismiss" and bounds(n):
            x, y = center(n); sh("adb", "shell", "input", "tap", str(x), str(y)); print("dismissed dev overlay"); time.sleep(0.8); return True
    return False
def scroll_search(q, attempt):
    """Not on screen yet: scroll down a page (attempts 2-4), then back to the top (attempt 5)."""
    if attempt in (2, 3, 4):
        sh("adb", "shell", "input", "swipe", "540", "1700", "540", "700", "350"); time.sleep(0.9)
    elif attempt == 5:
        for _ in range(4):
            sh("adb", "shell", "input", "swipe", "540", "600", "540", "1900", "250"); time.sleep(0.3)
def tap(q, idx=0):
    for attempt in range(7):
        root = dump()
        if dismiss_overlays(root):
            root = dump()
        ns = [n for n in root.iter("node") if matches(n, q) and bounds(n)]
        if ns:
            n = ns[min(idx, len(ns) - 1)]; x, y = center(n)
            if n.get("package") in APP_PKGS and (y > 2040 or y < 300) and attempt < 4:
                dy = 1300 - y
                sh("adb", "shell", "input", "swipe", "540", "1200", "540", str(max(200, min(2100, 1200 + dy))), "400"); print(f"scrolled target {q} by {dy}"); time.sleep(1.0); continue
            for b in root.iter("node"):
                if (b.get("content-desc") or "") == "Tools" and bounds(b):
                    bx1, by1, bx2, by2 = bounds(b)
                    if bx1 - 30 <= x <= bx2 + 30 and by1 - 30 <= y <= by2 + 30:
                        x = bounds(n)[0] + 18; print("avoiding Tools bubble")
            sh("adb", "shell", "input", "tap", str(x), str(y)); print(f"tap {q}[{idx}] @ {x},{y} text={n.get('text')!r}"); return True
        scroll_search(q, attempt); time.sleep(0.5)
    print(f"NOT FOUND: {q}"); return False
def wait(q, secs=15):
    t0 = time.time(); attempt = 0
    while time.time() - t0 < secs:
        if find(q): print(f"found {q}"); return True
        attempt += 1
        if attempt >= 3: scroll_search(q, 2 + (attempt - 3) % 4)
        time.sleep(0.7)
    print(f"TIMEOUT waiting for {q}"); return False
def type_text(t):
    esc = t.replace(" ", "%s")
    for ch in "&()'\"<>|;`$":
        esc = esc.replace(ch, "\\" + ch)
    sh("adb", "shell", "input", "text", esc); print(f"typed {t!r}")
def shot(path):
    with open(path, "wb") as f:
        subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=f, check=True)
    print(f"screenshot {path}")
if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "dump":
        for n in dump().iter("node"):
            if bounds(n) and (n.get("text") or n.get("resource-id") or n.get("content-desc")):
                print(bounds(n), "id=", n.get("resource-id"), "text=", (n.get("text") or "")[:80], "desc=", (n.get("content-desc") or "")[:40])
    elif cmd == "find":
        for n in find(args[0]): print(bounds(n), n.get("text"), n.get("resource-id"))
    elif cmd == "tap": sys.exit(0 if tap(args[0], int(args[1]) if len(args) > 1 else 0) else 1)
    elif cmd == "wait": sys.exit(0 if wait(args[0], int(args[1]) if len(args) > 1 else 15) else 1)
    elif cmd == "type": type_text(args[0])
    elif cmd == "back": sh("adb", "shell", "input", "keyevent", "4")
    elif cmd == "home": sh("adb", "shell", "input", "keyevent", "3")
    elif cmd == "hidekb": sh("adb", "shell", "input", "keyevent", "111")
    elif cmd == "shot": shot(args[0])
