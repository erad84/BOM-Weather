#!/usr/bin/env python3
import csv
from collections import defaultdict
from pathlib import Path

src = Path("/tmp/bom-postcodes/postcodes.csv")
out = Path("/mnt/e/Mark/webdev/Pebble watch/BOM Weather/src/pkjs/postcodes.js")

post = defaultdict(lambda: {"lat": 0.0, "lon": 0.0, "n": 0, "s": ""})

with src.open(newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        cat = (row.get("Category") or "").strip()
        if cat and cat != "Delivery Area":
            continue
        pc = (row.get("Postcode") or "").strip()
        state = (row.get("State") or "").strip().upper()
        try:
            lat = float(row.get("Lat") or 0)
            lon = float(row.get("Lon") or 0)
        except ValueError:
            continue
        if len(pc) != 4 or abs(lat) < 1 or abs(lon) < 1:
            continue
        post[pc]["lat"] += lat
        post[pc]["lon"] += lon
        post[pc]["n"] += 1
        if not post[pc]["s"]:
            post[pc]["s"] = state

lines = []
for pc in sorted(post.keys()):
    d = post[pc]
    lat = round(d["lat"] / d["n"], 3)
    lon = round(d["lon"] / d["n"], 3)
    lines.append("%s\\t%s\\t%s\\t%s" % (pc, d["s"], lat, lon))

body = "module.exports = \"" + "\\n".join(lines) + "\".split(\"\\n\").map(function(l){var p=l.split(\"\\t\");return{pc:p[0],s:p[1],lat:+p[2],lon:+p[3]};});\n"
out.write_text(body, encoding="utf-8")
print(out, out.stat().st_size, "bytes", len(post), "postcodes")
