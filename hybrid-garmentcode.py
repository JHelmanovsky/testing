from pathlib import Path
import copy, json, hashlib, yaml, sys

ROOT = Path(__file__).resolve().parent
GC = ROOT / "garmentcode"
sys.path.insert(0, str(GC))

from assets.garment_programs.meta_garment import MetaGarment
from assets.bodies.body_params import BodyParameters

OUT = ROOT / "hybrid-output" / "garmentcode"
OUT.mkdir(parents=True, exist_ok=True)

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

body_path = GC / "assets/bodies/mean_female.yaml"
body = BodyParameters(str(body_path))

with open(GC / "assets/design_params/default.yaml", "r") as f:
    d = yaml.safe_load(f)["design"]

# User-selected style:
# fitted/sheath, fitted bodice, V-front, V-back, sleeveless,
# godet/mermaid, ankle length, waistband

d["meta"]["upper"]["v"] = "FittedShirt"
d["meta"]["wb"]["v"] = "FittedWB"
d["meta"]["bottom"]["v"] = "GodetSkirt"

# Fitted bodice
d["shirt"]["strapless"]["v"] = False
d["shirt"]["length"]["v"] = 1.0
d["shirt"]["width"]["v"] = 1.0
d["shirt"]["flare"]["v"] = 1.0

# Medium V front + V back
d["collar"]["f_collar"]["v"] = "VNeckHalf"
d["collar"]["b_collar"]["v"] = "VNeckHalf"
d["collar"]["fc_depth"]["v"] = 0.9
d["collar"]["bc_depth"]["v"] = 0.7
d["collar"]["component"]["style"]["v"] = None

# Sleeveless
d["sleeve"]["sleeveless"]["v"] = True
d["sleeve"]["armhole_shape"]["v"] = "ArmholeCurve"

# Fitted waistband/yoke
d["waistband"]["waist"]["v"] = 1.0
d["waistband"]["width"]["v"] = 0.18

# Mermaid/godet lower section
# Long pencil base, then 8 godets inserted from lower skirt
d["godet-skirt"]["base"]["v"] = "PencilSkirt"
d["godet-skirt"]["insert_w"]["v"] = 28
d["godet-skirt"]["insert_depth"]["v"] = 38
d["godet-skirt"]["num_inserts"]["v"] = 8
d["godet-skirt"]["cuts_distance"]["v"] = 3

# Ankle-length pencil base
d["pencil-skirt"]["length"]["v"] = 0.84
d["pencil-skirt"]["rise"]["v"] = 1.0
d["pencil-skirt"]["flare"]["v"] = 0.92
d["pencil-skirt"]["front_slit"]["v"] = 0
d["pencil-skirt"]["back_slit"]["v"] = 0
d["pencil-skirt"]["left_slit"]["v"] = 0
d["pencil-skirt"]["right_slit"]["v"] = 0

garment = MetaGarment("atelier-helmanovska-test-dress-001", body, d)
pattern = garment.assembly()
self_intersection = bool(garment.is_self_intersecting())

folder = Path(pattern.serialize(
    OUT,
    tag="generated",
    to_subfolder=True,
    with_3d=False,
    with_text=True,
    view_ids=False,
    with_printable=True,
))

files = sorted(p for p in folder.iterdir() if p.is_file())
spec = next(p for p in files if p.name.endswith("_specification.json"))
svg = next(p for p in files if p.name.endswith("_pattern.svg") and "print" not in p.name)
pdf = next(p for p in files if p.suffix == ".pdf")
print_svg = next(p for p in files if p.name.endswith("_print_pattern.svg"))

data = json.loads(spec.read_text())
panels = data["pattern"]["panels"]
result = {
    "engine": "GarmentCode / pygarment",
    "role": "Complete modular dress generator",
    "bodyFixture": "mean_female",
    "style": {
        "silhouette": "fitted/sheath",
        "bodiceFit": "fitted",
        "frontNeckline": "V medium",
        "backNeckline": "V medium",
        "sleeves": "sleeveless",
        "skirt": "godet/mermaid",
        "length": "ankle",
        "waistband": "fitted waistband",
        "godets": 8
    },
    "panelCount": len(panels),
    "panelNames": list(panels.keys()),
    "vertexCount": sum(len(p["vertices"]) for p in panels.values()),
    "edgeCount": sum(len(p["edges"]) for p in panels.values()),
    "stitchCount": len(data["pattern"].get("stitches", [])),
    "selfIntersecting": self_intersection,
    "specBytes": spec.stat().st_size,
    "specSha256": sha(spec),
    "svgBytes": svg.stat().st_size,
    "svgSha256": sha(svg),
    "printableSvgBytes": print_svg.stat().st_size,
    "pdfBytes": pdf.stat().st_size,
    "files": [p.name for p in files],
}
(OUT / "garmentcode-dress-001.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))

if self_intersection:
    raise SystemExit("Generated dress self-intersects")
