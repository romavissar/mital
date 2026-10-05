$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $root ".packaging-venv\Scripts\python.exe"

Push-Location $root
try {
    py -3.13 -m venv .packaging-venv
    if ($LASTEXITCODE -ne 0) { throw "Python 3.13 is required to build the Windows solver." }

    & $python -m pip install -e (Join-Path $root "solver") "pyinstaller==6.22.3"
    if ($LASTEXITCODE -ne 0) { throw "Could not install solver build dependencies." }

    & $python (Join-Path $root "packaging\build_solver.py")
    if ($LASTEXITCODE -ne 0) { throw "The bundled solver did not pass its sample solve." }

    Push-Location (Join-Path $root "web")
    try {
        corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "Could not install desktop build dependencies." }
        corepack pnpm build
        if ($LASTEXITCODE -ne 0) { throw "Could not build the interface." }
        corepack pnpm dist:win --x64
        if ($LASTEXITCODE -ne 0) { throw "Could not create the Windows installer." }
    } finally {
        Pop-Location
    }
    Write-Host "Windows installer is in $root\web\release"
} finally {
    Pop-Location
}
