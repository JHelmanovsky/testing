from pathlib import Path
import copy, json, hashlib, shutil, yaml, sys

ROOT = Path(__file__).resolve().parent
GC = ROOT / "garmentcode"
sys.path.insert(0, str(GC))

from assets.garment_programs.meta_garment import MetaGarment
from assets.bodies.body_params import BodyParameters

OUT = ROOT / "garmentcode-output"
OUT.mkdir(exist_ok=True)

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

with open(GC / "assets/design_params/default.yaml", "r") as f:
    base = yaml.safe_load(f)["design"]

def make_design(neck="VNeckHalf", skirt="SkirtCircle", skirt_length=0.72, suns=0.75):
    d = copy.deepcopy(base)
    d["meta"]["upper"]["v"] = "FittedShirt"
    d["meta"]["bottom"]["v"] = skirt
    d["meta"]["wb"]["v"] = None
    d["shirt"]["strapless"]["v"] = False
    d["shirt"]["length"]["v"] = 1.0
    d["shirt"]["width"]["v"] = 1.02
    d["shirt"]["flare"]["v"] = 1.0
    d["collar"]["f_collar"]["v"] = neck
    d["collar"]["b_collar"]["v"] = "CircleNeckHalf"
    d["collar"]["fc_depth"]["v"] = 0.8
    d["sleeve"]["sleeveless"]["v"] = True
    d["flare-skirt"]["length"]["v"] = skirt_length
    d["flare-skirt"]["suns"]["v"] = suns
    d["skirt"]["length"]["v"] = skirt_length
    return d

def generate(label, body_path, design):
    body = BodyParameters(str(body_path))
    garment = MetaGarment(label, body, design)
    pattern = garment.assembly()
    self_intersecting = bool(garment.is_self_intersecting())
    folder = Path(pattern.serialize(
        OUT,
        tag="generated",
        to_subfolder=True,
        with_3d=False,
        with_text=False,
        view_ids=False,
        with_printable=True,
    ))
    files = sorted([p for p in folder.iterdir() if p.is_file()])
    spec = next(p for p in files if p.name.endswith("_specification.json"))
    svg = next((p for p in files if p.name.endswith("_pattern.svg") and "print" not in p.name), None)
    printable_svg = next((p for p in files if p.name.endswith("_print_pattern.svg")), None)
    pdf = next((p for p in files if p.suffix == ".pdf"), None)
    data = json.loads(spec.read_text())
    panels = data["pattern"]["panels"]
    vertices = sum(len(p["vertices"]) for p in panels.values())
    edges = sum(len(p["edges"]) for p in panels.values())
    stitches = len(data["pattern"].get("stitches", []))
    return {
        "label": label,
        "folder": str(folder),
        "selfIntersecting": self_intersecting,
        "panelCount": len(panels),
        "vertexCount": vertices,
        "edgeCount": edges,
        "stitchCount": stitches,
        "specBytes": spec.stat().st_size,
        "specSha256": sha(spec),
        "svgBytes": svg.stat().st_size if svg else None,
        "svgSha256": sha(svg) if svg else None,
        "printableSvgBytes": printable_svg.stat().st_size if printable_svg else None,
        "pdfBytes": pdf.stat().st_size if pdf else None,
        "files": [p.name for p in files],
    }

body_base = GC / "assets/bodies/mean_female.yaml"

baseline = generate("dress-vneck-circle", body_base, make_design())

# Design variation: square neckline
square = generate("dress-square-circle", body_base, make_design(neck="SquareNeckHalf"))

# Design variation: pencil skirt
pencil_design = make_design(neck="VNeckHalf", skirt="PencilSkirt")
pencil_design["pencil-skirt"]["length"]["v"] = 0.72
pencil = generate("dress-vneck-pencil", body_base, pencil_design)

# Body variation: alter bust and waist from the mean female body
body_data = yaml.safe_load(body_base.read_text())
body_changed = copy.deepcopy(body_data)
body_changed["body"]["bust"] += 10.0
body_changed["body"]["waist"] += 8.0
changed_body_path = OUT / "mean_female_changed.yaml"
changed_body_path.write_text(yaml.safe_dump(body_changed))
body_changed_result = generate("dress-vneck-circle-bodychanged", changed_body_path, make_design())

# Deterministic repeat
repeat = generate("dress-vneck-circle-repeat", body_base, make_design())

results = {
    "engine": "GarmentCode / pygarment",
    "bodyFixture": "mean_female",
    "baseline": baseline,
    "squareNeckline": square,
    "pencilSkirt": pencil,
    "changedBody": body_changed_result,
    "repeat": repeat,
    "checks": {
        "generatedPattern": baseline["panelCount"] > 0 and baseline["specBytes"] > 0,
        "generatedSvg": bool(baseline["svgBytes"]),
        "generatedPrintablePdf": bool(baseline["pdfBytes"]),
        "necklineChangesGeometry": square["specSha256"] != baseline["specSha256"],
        "skirtChangesGeometry": pencil["specSha256"] != baseline["specSha256"],
        "bodyChangesGeometry": body_changed_result["specSha256"] != baseline["specSha256"],
        "deterministicGeometry": repeat["specSha256"] == baseline["specSha256"],
        "baselineNoSelfIntersection": not baseline["selfIntersecting"],
    }
}
(OUT / "results.json").write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))

failed = [k for k,v in results["checks"].items() if not v]
if failed:
    print("FAILED CHECKS:", failed)
    raise SystemExit(2)
