"""Synthetic integration checks; no generated game artwork is created."""
from pathlib import Path
import json
import sys
import tempfile
import zipfile

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.prepare_assets_v4 import NAMES, GREEN, build, self_test

self_test()
with tempfile.TemporaryDirectory(prefix="kb-matte-test-") as directory:
    root = Path(directory)
    raw = root/"raw"
    out = root/"out"
    raw.mkdir()
    base = np.full((150, 100, 3), GREEN, dtype=np.uint8)
    base[20:145, 20:80] = [85, 95, 65]
    base[45:75, 35:65] = GREEN
    edited = np.full_like(base, [200, 20, 15])
    for name in NAMES:
        Image.fromarray(base).save(raw/(name+".png"))
        Image.fromarray(edited).save(raw/(name+"_beszel.png"))
    Image.new("RGB", (160, 90), "#65432A").save(raw/"targyalotterem.png")
    regions = root/"mouth_regions.json"
    regions.write_text(json.dumps({n: [390, 970, 640, 1170] for n in NAMES}), encoding="utf-8")
    build(raw, out, regions, None)
    for name in NAMES:
        closed = Image.open(out/(name+".png"))
        opened = Image.open(out/(name+"_beszel.png"))
        assert closed.mode == opened.mode == "RGBA"
        assert closed.size == opened.size == (1024, 1536)
        assert np.array_equal(np.asarray(closed)[:, :, 3], np.asarray(opened)[:, :, 3])
    for suffix in ("png", "jpg"):
        assert Image.open(out/("targyalotterem."+suffix)).size == (1920, 1080)
    assert Image.open(out/"kontaktlap.png").size == (1120, 1728)
    with zipfile.ZipFile(out/"assets_v4.zip") as archive:
        assert len(archive.namelist()) == 20
        assert archive.testzip() is None
    print("PASS: 16 equal RGBA canvases, aligned alpha, room sizes, 16-character contact sheet and complete ZIP")
