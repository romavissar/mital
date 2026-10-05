# Desktop builds

mital's interface is a static React build inside Electron. Electron starts the bundled Python solver locally; production does not start a web server or database.

## Source run

From the repository root, install the solver and interface dependencies, then open the app:

```bash
cd solver && python3 -m pip install -e '.[dev]'
cd ../web && corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm desktop
```

`MITAL_PYTHON` selects a different Python interpreter for source runs. Business files are stored in the OS app-data folder shown by **Settings → Open data folder**.

## Build installers

Use Python 3.13 and Node.js with Corepack. On an Apple Silicon Mac, from `web/`:

```bash
python3 -m venv ../.packaging-venv
../.packaging-venv/bin/python -m pip install -e ../solver pyinstaller==6.22.3
../.packaging-venv/bin/python ../packaging/build_solver.py
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm dist:mac --arm64
```

On Windows x64, from the repository root in PowerShell:

```powershell
.\packaging\build-windows.ps1
```

Installers appear in `web/release/`. The solver build smoke-tests its native binary. Mac release builds require a Developer ID Application certificate and Apple notarization credentials; packaging stops if either is missing. After packaging, verify the app with `codesign --verify --deep --strict --verbose=2 release/mac-arm64/mital.app` and `spctl --assess --type execute --verbose=4 release/mac-arm64/mital.app` before uploading the DMG. Test the downloaded installer on a second Mac.
