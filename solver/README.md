# mital solver

The Python scheduling model used by mital. Install from this directory with `python3 -m pip install -e '.[dev]'`, then run `python3 -m pytest -q`.

The [model](../docs/model.md) explains the objective and constraints; the [data contract](../docs/data-contract.md) defines the JSON input and output. The desktop app calls `mital_solver.desktop_bridge` locally through standard input and output.
