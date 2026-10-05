"""Bundle the solver for the current OS before running electron-builder."""

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
stage = WEB / "build" / "staging" / "mital_solver"
if stage.exists():
    shutil.rmtree(stage)
shutil.copytree(ROOT / "solver", stage, ignore=shutil.ignore_patterns("__pycache__", "*.egg-info", "tests", ".pytest_cache", ".hypothesis"))

subprocess.run([
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
    "--name", "mital-solver-bridge", "--collect-all", "highspy",
    "--paths", str(stage.parent),
    "--distpath", str(WEB / "build" / "solver"),
    "--workpath", str(WEB / "build" / "pyinstaller"),
    "--specpath", str(WEB / "build"),
    str(ROOT / "packaging" / "bridge_entry.py"),
], cwd=ROOT, check=True, env={**os.environ, "PYINSTALLER_CONFIG_DIR": str(WEB / "build" / "pyinstaller-config")})

binary = WEB / "build" / "solver" / "mital-solver-bridge" / ("mital-solver-bridge.exe" if sys.platform == "win32" else "mital-solver-bridge")
instance = json.loads((ROOT / "data" / "instances" / "cafe_08.json").read_text())
request = json.dumps({"op": "solve", "payload": {"instance": instance, "time_limit_s": 8}}).encode()
result = subprocess.run([str(binary)], input=request, capture_output=True, cwd=ROOT, timeout=60)
response = json.loads(result.stdout)
if not response.get("ok") or response["result"]["status"] not in {"optimal", "feasible"}:
    raise SystemExit(f"Bundled solver smoke test failed: {response.get('error', result.stderr.decode(errors='replace'))}")
print(f"Built and solved a sample schedule with {binary}")
