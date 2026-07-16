#!/usr/bin/env python3
"""Self-contained production-readiness scorer (mirrors aion_platform weights)."""
import json, os, sys
try:
    import yaml
except ImportError:
    print("pip install pyyaml", file=sys.stderr); sys.exit(2)

WEIGHTS = {"automated_tests":15,"reproducible_deployment":15,"live_integrations":15,
           "secrets_management":10,"monitoring":10,"backup_recovery":10,"rollback":10,
           "failure_testing":5,"compliance":5,"business_outcomes":5}
CREDIT = {0:0.0,1:0.30,2:0.55,3:0.75,4:0.90,5:1.00}

def level(c):
    if not c.get("implemented"): return 0
    if c.get("production_verified") or c.get("live_verified"): return 5
    if c.get("staging_verified"): return 4
    if c.get("integration_verified"): return 3
    if c.get("ci_verified") or c.get("mocked_verified"): return 2
    return 1

def status(s):
    return "green" if s>=85 else "yellow" if s>=60 else "orange" if s>=40 else "red"

def main(path, out):
    m = yaml.safe_load(open(path))
    controls = m.get("controls")
    if not m.get("version") or not m.get("repository") or not isinstance(controls, dict):
        print("MALFORMED manifest", file=sys.stderr); return 2
    missing = [c for c in WEIGHTS if c not in controls]
    if missing:
        print(f"MALFORMED manifest, missing: {missing}", file=sys.stderr); return 2
    total, breakdown = 0.0, {}
    for cat, w in WEIGHTS.items():
        lv = level(controls.get(cat) or {})
        awarded = w*CREDIT[lv]; total += awarded
        breakdown[cat] = {"weight": w, "level": lv, "awarded": round(awarded,2)}
    score = round(total,1)
    result = {"repository": m["repository"], "score": score, "status": status(score), "breakdown": breakdown}
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    json.dump(result, open(out,"w"), indent=2)
    print(json.dumps({"repository": m["repository"], "score": score, "status": status(score)}, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1], sys.argv[2] if len(sys.argv)>2 else "artifacts/production-readiness.json"))
