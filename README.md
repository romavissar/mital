# mital

mital is an offline desktop app for building weekly staff schedules. Managers set shifts, staffing needs, availability, contracted hours, and pay; mital proposes a schedule and shows any gaps it cannot fill. Business data stays in local files on the user's computer. There is no account, cloud sync, or database.

The app supports English and Romanian, hourly wages or monthly salaries, a cost–fairness comparison, sick/out days, schedule repair, print, CSV export, and local backups. It is MIT licensed.

## How the model works

The Python solver creates a yes/no assignment for each employee, shift, and day where that person is available and qualified. It uses a mixed-integer linear program solved by HiGHS. It respects one shift per day, absences, manager-entered hour limits, and any maximum staff per shift.

It first minimizes shortfalls in shift staffing, required supervision, and contracted minimum hours, in that order. It then balances estimated pay, overtime, and fairness. Minimums are soft when the available staff cannot satisfy them; the app reports the remaining gaps instead of claiming full coverage. The fairness control compares complete schedules with the same coverage. Pay figures are planning estimates, not payroll or legal advice. The app does not impose regional work rules.

See [the model](docs/model.md) and [data contract](docs/data-contract.md) for the formulation and JSON schema.

## Run from source

Requires Python 3.13, Node.js, and Corepack.

```bash
cd solver
python3 -m pip install -e '.[dev]'
cd ../web
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm desktop
```

Run checks with `python3 -m pytest -q` from `solver/`, and `corepack pnpm lint && corepack pnpm test:desktop` from `web/`.

## Installers

[Desktop build instructions](web/README.md) cover macOS and Windows. Installer files and test output are excluded from Git; publish tested builds through GitHub Releases or the project website. The current macOS build is unsigned, and the Windows installer must be built and tested on Windows.

## License

[MIT](LICENSE)
