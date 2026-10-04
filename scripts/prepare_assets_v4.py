"""Green-screen postprocessing for the 17 generated Kamu Bíróság images.

Requires Pillow, numpy and scipy. Does not generate images or invent faces.
Speaking edits are composited into explicitly inspected mouth rectangles;
all pixels outside those rectangles and both alpha channels stay identical.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import tempfile
import shutil
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from scipy import ndimage

NAMES = ("biro", "ugyesz", "vadlott", "vedougyved", "eskudt1", "eskudt2", "eskudt3", "tanu")
GREEN = np.array([0, 177, 64], dtype=np.float32)
SIZE = (1024, 1536)


def remove_green(rgb: np.ndarray, protect: np.ndarray | None = None) -> np.ndarray:
    """Border flood-fill plus strictly green enclosed holes, 3–4 px feather.

    Olive/green-brown clothing differs from the key and stays opaque. An
    optional hand-reviewed protection mask (white = keep) can protect genuine
    clothing that happens to match the exact key, which colour alone cannot
    distinguish from an enclosed background hole.
    """
    colour = rgb.astype(np.float32)
    distance = np.linalg.norm(colour - GREEN, axis=2)
    dominant = colour[:, :, 1] - np.maximum(colour[:, :, 0], colour[:, :, 2])
    candidate = (distance < 55) & (dominant > 40)
    strict = (distance < 16) & (dominant > 70)
    if protect is not None:
        candidate &= ~protect
        strict &= ~protect
    border = np.zeros(candidate.shape, dtype=bool)
    border[0, :] = border[-1, :] = True
    border[:, 0] = border[:, -1] = True
    background = ndimage.binary_propagation(border & strict, mask=candidate)
    # Hair/arm holes disconnected from the image edge still contain the same
    # flat key colour. Reject components that merely have greenish clothing.
    labels, count = ndimage.label(candidate & ~background)
    if count:
        sizes = np.bincount(labels.ravel(), minlength=count + 1)
        key_sizes = np.bincount(labels[strict].ravel(), minlength=count + 1)
        remove = (key_sizes >= 2) & (key_sizes / np.maximum(sizes, 1) >= .65)
        remove[0] = False
        background |= remove[labels]
    foreground = ~background
    if not background.any() or not foreground.any():
        raise ValueError("No usable green background / subject detected")
    alpha = ndimage.gaussian_filter(foreground.astype(np.float32), sigma=1.0)
    inside_distance = ndimage.distance_transform_edt(foreground)
    outside_distance, nearest = ndimage.distance_transform_edt(background, return_indices=True)
    alpha[inside_distance >= 4] = 1
    alpha[outside_distance >= 4] = 0
    if protect is not None:
        alpha[protect] = 1
    # Soft alpha creates some edge pixels outside the hard silhouette. Give
    # these foreground RGB instead of leaving the original solid green there.
    colour[background] = colour[nearest[0][background], nearest[1][background]]
    edge = (alpha > 0) & (alpha < .995)
    excess = colour[:, :, 1] - np.maximum(colour[:, :, 0], colour[:, :, 2])
    spill = edge & (excess > 15)
    colour[:, :, 1][spill] -= excess[spill] * .92
    colour[alpha <= 0] = 0
    rgba = np.dstack((np.clip(colour, 0, 255).astype(np.uint8), np.rint(alpha * 255).astype(np.uint8)))
    return rgba


def speaking_pair(base: np.ndarray, edited: np.ndarray, mouth: list[int], protect=None):
    if edited.shape != base.shape:
        raise ValueError("Base and speaking edit must have identical dimensions")
    x0, y0, x1, y1 = map(int, mouth)
    h, w = base.shape[:2]
    if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
        raise ValueError("Mouth rectangle outside image")
    closed = remove_green(base, protect)
    opened = closed.copy()
    height, width = y1-y0, x1-x0
    yy, xx = np.mgrid[:height, :width]
    feather = np.minimum.reduce((xx, yy, width-1-xx, height-1-yy)).astype(np.float32)
    weight = np.clip(feather / 3.0, 0, 1)[:, :, None]
    before = closed[y0:y1, x0:x1, :3].astype(np.float32)
    after = edited[y0:y1, x0:x1, :3].astype(np.float32)
    opened[y0:y1, x0:x1, :3] = np.rint(before * (1-weight) + after * weight).astype(np.uint8)
    # Alpha is copied from the base, never independently re-keyed or cropped.
    outside = np.ones((h, w), dtype=bool)
    outside[y0:y1, x0:x1] = False
    assert np.array_equal(opened[outside], closed[outside])
    assert np.array_equal(opened[:, :, 3], closed[:, :, 3])
    return closed, opened


def load_character(path: Path):
    image = Image.open(path).convert("RGB")
    if abs(image.width / image.height - 2/3) > .003:
        raise ValueError(f"{path.name}: expected a 2:3 canvas; do not stretch the character")
    return np.asarray(image.resize(SIZE, Image.Resampling.LANCZOS))


def contact_sheet(folder: Path):
    cell_w, cell_h = 280, 432
    sheet = Image.new("RGB", (cell_w*4, cell_h*4), "#2B1A12")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 17)
    except OSError:
        font = ImageFont.load_default()
    for index, name in enumerate(NAMES):
        for speaking in range(2):
            stem = name + ("_beszel" if speaking else "")
            col, row = (index % 2)*2+speaking, index//2
            image = Image.open(folder/(stem+".png")).convert("RGBA")
            image.thumbnail((250, 375), Image.Resampling.LANCZOS)
            x, y = col*cell_w+(cell_w-image.width)//2, row*cell_h+12
            sheet.paste(image, (x, y), image)
            draw.text((col*cell_w+10, row*cell_h+395), stem, font=font, fill="#F8E7D2")
    sheet.save(folder/"kontaktlap.png")


def build(raw: Path, output: Path, regions: Path, protected: Path | None):
    boxes = json.loads(regions.read_text(encoding="utf-8"))
    expected = [raw/(n+s+".png") for n in NAMES for s in ("", "_beszel")]
    expected += [raw/"targyalotterem.png"]
    missing = [str(p) for p in expected if not p.is_file()]
    if missing:
        raise ValueError("Missing generated images: " + ", ".join(missing))
    if any(n not in boxes for n in NAMES):
        raise ValueError("Supply inspected mouth rectangles for all 8 characters, in final 1024x1536 coordinates")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kb-assets-", dir=output.parent) as tmp:
        stage = Path(tmp)
        report = {"canvas": list(SIZE), "characters": [], "manual_review_required": "Inspect all edges and mouth patches on kontaktlap.png before delivery"}
        for name in NAMES:
            base = load_character(raw/(name+".png"))
            edit = load_character(raw/(name+"_beszel.png"))
            mask_path = protected/(name+".png") if protected else None
            protect = None
            if mask_path and mask_path.is_file():
                mask = Image.open(mask_path).convert("L").resize(SIZE, Image.Resampling.NEAREST)
                protect = np.asarray(mask) > 127
            closed, opened = speaking_pair(base, edit, boxes[name], protect)
            Image.fromarray(closed).save(stage/(name+".png"))
            Image.fromarray(opened).save(stage/(name+"_beszel.png"))
            report["characters"].append({"name": name, "mode": "RGBA", "mouth_rect": boxes[name], "alpha_identical": True, "changed_pixels_outside_mouth": 0})
        room_source = Image.open(raw/"targyalotterem.png").convert("RGB")
        room = ImageOps.fit(room_source, (1920, 1080), Image.Resampling.LANCZOS, centering=(.5, .5))
        report["room_source_size"] = list(room_source.size)
        report["room_crop_required"] = abs(room_source.width/room_source.height - 16/9) > .003
        room.save(stage/"targyalotterem.png")
        room.save(stage/"targyalotterem.jpg", quality=92, subsampling=0)
        contact_sheet(stage)
        (stage/"ellenorzes.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        names = sorted(p.name for p in stage.iterdir())
        with zipfile.ZipFile(stage/"assets_v4.zip", "w", zipfile.ZIP_DEFLATED) as archive:
            for filename in names:
                archive.write(stage/filename, filename)
        output.mkdir(parents=True, exist_ok=True)
        for p in stage.iterdir():
            shutil.copy2(p, output/p.name)
    print(f"16 RGBA characters, 2 courtroom files, contact sheet and assets_v4.zip: {output}")


def self_test():
    rgb = np.full((150, 100, 3), GREEN, dtype=np.uint8)
    rgb[20:145, 20:80] = [85, 95, 65]  # green-brown witness coat
    rgb[45:75, 35:65] = GREEN         # enclosed arm/hair background hole
    rgba = remove_green(rgb)
    assert rgba[0, 0, 3] == 0
    assert rgba[100, 50, 3] == 255
    assert np.array_equal(rgba[100, 50, :3], rgb[100, 50])
    assert rgba[60, 50, 3] == 0
    assert np.any((rgba[:, :, 3] > 0) & (rgba[:, :, 3] < 255))
    edited = np.full_like(rgb, [200, 20, 15])  # deliberate drift outside mouth
    closed, opened = speaking_pair(rgb, edited, [38, 95, 62, 114])
    outside = np.ones((150, 100), dtype=bool)
    outside[95:114, 38:62] = False
    assert np.array_equal(closed[outside], opened[outside])
    assert np.array_equal(closed[:, :, 3], opened[:, :, 3])
    assert not np.array_equal(closed[100, 50, :3], opened[100, 50, :3])
    print("PASS: border removal, enclosed hole, olive clothing, soft alpha, identical paired placement, mouth-only edit")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--mouth-regions", type=Path)
    parser.add_argument("--protect-dir", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    elif args.raw and args.out and args.mouth_regions:
        build(args.raw, args.out, args.mouth_regions, args.protect_dir)
    else:
        parser.error("Use --self-test, or --raw DIR --out DIR --mouth-regions FILE")
