"""Figures from results/benchmark.csv and a fixed price-of-fairness table."""

from __future__ import annotations

import csv
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = ROOT / "results" / "benchmark.csv"
OUT = ROOT / "results"

# Equal-coverage for H1 (uncovered + supervisor_gap both match MILP).
EQUAL_COV = {"cafe_18", "clinic_25", "retail_60"}

# Price-of-fairness table from a frontier-neighbour comparison.
POF = [
    ("cafe_08", "cafe", 8, 9.46),
    ("retail_10", "retail", 10, 11.59),
    ("cafe_18", "cafe", 18, 9.70),
    ("clinic_25", "clinic", 25, 3.27),
    ("cafe_40", "cafe", 40, 2.05),
    ("retail_40", "retail", 40, 3.71),
    ("retail_60", "retail", 60, 4.44),
]

FAMILY_STYLE = {
    "cafe": {"marker": "o", "color": "#1f4e79"},
    "clinic": {"marker": "s", "color": "#2a6f4e"},
    "retail": {"marker": "D", "color": "#8b3a2a"},
}


def _load_compare() -> list[dict]:
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8")))
    return [r for r in rows if r["suite"] == "compare"]


def _load_scale() -> list[dict]:
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8")))
    return [r for r in rows if r["suite"] == "scale"]


def fig1_cost_gap() -> Path:
    """Wage bill (wages+OT) by method; mark equal-coverage instances."""
    rows = _load_compare()
    by_inst: dict[str, dict[str, dict]] = {}
    for r in rows:
        by_inst.setdefault(r["instance"], {})[r["method"]] = r

    order = ["cafe_08", "cafe_18", "clinic_25", "retail_40", "retail_60", "tight_20"]
    methods = ["milp", "greedy", "round_robin"]
    labels = {
        "milp": "MILP",
        "greedy": "Greedy",
        "round_robin": "Round-robin",
    }
    colors = {"milp": "#1f4e79", "greedy": "#c47b2c", "round_robin": "#6b6b6b"}

    x = np.arange(len(order))
    width = 0.25
    fig, ax = plt.subplots(figsize=(10, 5.2))

    for i, method in enumerate(methods):
        vals = []
        for inst in order:
            r = by_inst[inst][method]
            vals.append(float(r["wages"]) + float(r["overtime"]))
        bars = ax.bar(
            x + (i - 1) * width,
            vals,
            width,
            label=labels[method],
            color=colors[method],
            edgecolor="white",
            linewidth=0.5,
        )
        # Hatch non-equal-coverage for greedy/rr so H1 scope is visible.
        if method != "milp":
            for j, inst in enumerate(order):
                if inst not in EQUAL_COV:
                    bars[j].set_hatch("//")
                    bars[j].set_alpha(0.85)

    ax.set_xticks(x)
    ax.set_xticklabels(
        [
            f"{inst}\n{'★ eq-cov' if inst in EQUAL_COV else ''}"
            for inst in order
        ]
    )
    ax.set_ylabel("Wage bill (wages + overtime), €")
    ax.set_title(
        "Figure 1 — Labor cost by method\n"
        "★ equal-coverage (C1 uncovered + C6 supervisor gaps match MILP); "
        "hatched = not equal-coverage"
    )
    ax.legend(frameon=False)
    ax.set_ylim(0, None)
    # Annotate wage savings on equal-coverage greedy bars.
    for j, inst in enumerate(order):
        if inst not in EQUAL_COV:
            continue
        mw = float(by_inst[inst]["milp"]["wages"]) + float(
            by_inst[inst]["milp"]["overtime"]
        )
        gw = float(by_inst[inst]["greedy"]["wages"]) + float(
            by_inst[inst]["greedy"]["overtime"]
        )
        sav = (gw - mw) / gw * 100.0
        ax.annotate(
            f"{sav:.1f}%",
            xy=(x[j], gw),
            xytext=(0, 6),
            textcoords="offset points",
            ha="center",
            fontsize=8,
            color=colors["greedy"],
        )

    fig.tight_layout()
    out = OUT / "fig1_cost_gap.png"
    fig.savefig(out, dpi=160)
    plt.close(fig)
    return out


def fig2_pof() -> Path:
    fig, ax = plt.subplots(figsize=(8.5, 5))
    for family in ("cafe", "clinic", "retail"):
        pts = [p for p in POF if p[1] == family]
        if not pts:
            continue
        xs = [p[2] for p in pts]
        ys = [p[3] for p in pts]
        style = FAMILY_STYLE[family]
        ax.plot(
            xs,
            ys,
            marker=style["marker"],
            color=style["color"],
            linestyle="none",
            markersize=9,
            label=family,
        )
        for name, _fam, n, pof in pts:
            ax.annotate(
                name,
                (n, pof),
                textcoords="offset points",
                xytext=(6, 4),
                fontsize=8,
                color=style["color"],
            )

    ax.axhline(3.0, color="#888", linestyle="--", linewidth=1, label="H2 ≈3%")
    ax.set_xlabel("Employees |E|")
    ax.set_ylabel("Price of fairness (%)")
    ax.set_title(
        "Figure 2 — Price of fairness vs roster size\n"
        "Frontier-neighbour wage bill; axis is |E| (family is not the driver)"
    )
    ax.legend(frameon=False, loc="upper right")
    ax.set_ylim(0, 14)
    ax.set_xlim(0, 70)
    fig.tight_layout()
    out = OUT / "fig2_price_of_fairness.png"
    fig.savefig(out, dpi=160)
    plt.close(fig)
    return out


def fig3_scaling() -> Path:
    rows = _load_scale()
    rows = sorted(rows, key=lambda r: int(r["n_employees"]))
    ns = [int(r["n_employees"]) for r in rows]
    times = [float(r["solve_time_s"]) for r in rows]
    statuses = [r["status"] for r in rows]

    fig, ax = plt.subplots(figsize=(8.5, 5))
    for n, t, st in zip(ns, times, statuses):
        color = "#8b3a2a" if st == "timeout" else "#1f4e79"
        marker = "X" if st == "timeout" else "o"
        ax.plot(n, t, marker=marker, color=color, markersize=10, linestyle="none")
        label = f"{st}" if st == "timeout" else f"{t:.1f}s"
        ax.annotate(
            label,
            (n, t),
            textcoords="offset points",
            xytext=(6, 4),
            fontsize=8,
        )

    ax.plot(ns, times, color="#1f4e79", alpha=0.35, linewidth=1.5)
    ax.axhline(
        5.0,
        color="#c47b2c",
        linestyle="--",
        linewidth=1.4,
        label="5 s interactive budget",
    )
    ax.set_yscale("log")
    ax.set_xlabel("Employees |E|")
    ax.set_ylabel("Solve time (s, log scale)")
    ax.set_title(
        "Figure 3 — Scaling at the 5 s interactive budget\n"
        "retail_60 = timeout, mip_gap≈32%, understaffing > 0 (H3)"
    )
    ax.legend(frameon=False)
    ax.set_xlim(0, 70)
    fig.tight_layout()
    out = OUT / "fig3_scaling.png"
    fig.savefig(out, dpi=160)
    plt.close(fig)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    paths = [fig1_cost_gap(), fig2_pof(), fig3_scaling()]
    for p in paths:
        print(p)


if __name__ == "__main__":
    main()
