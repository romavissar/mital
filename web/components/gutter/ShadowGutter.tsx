
import { useState } from "react";

import type { ExactMarginEntry, MarginsResponse } from "@/lib/types";
import { useLanguage } from "@/lib/i18n";

type Status = "idle" | "pending" | "ready" | "error";

type Props = {
  margins: ExactMarginEntry[];
  status: Status;
  error?: string | null;
  computeTimeS?: number | null;
  note?: string | null;
  source?: MarginsResponse["source"] | null;
};

function periodClock(period: number): string {
  const minutes = period * 15;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function ShadowGutter({
  margins,
  status,
  error = null,
  computeTimeS = null,
  note = null,
  source = null,
}: Props) {
  const language = useLanguage();
  const points = (value: number) => new Intl.NumberFormat(language === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 0, signDisplay: "exceptZero" }).format(value);
  const [selected, setSelected] = useState<number | null>(null);
  const active = selected != null ? margins[selected] : null;
  const exact = source === "exact_precomputed";
  const label = language === "ro" ? "Cum se schimbă scorul la un necesar mai mare" : "How extra coverage changes the score";

  return (
    <aside className="gutter" aria-label={label}>
      <div className="gutter__head">
        <p className="label">{label}</p>
        {status === "pending" ? (
          <p className="gutter__status">
            {language === "ro" ? "Se calculează exemple local…" : "Checking examples locally…"}
          </p>
        ) : status === "ready" && computeTimeS != null ? (
          <p className="gutter__status num">{computeTimeS.toFixed(0)}s</p>
        ) : status === "error" ? (
          <p className="gutter__status gutter__status--alarm">{language === "ro" ? "Nu s-a putut calcula" : "Could not calculate"}</p>
        ) : null}
      </div>

      {status === "pending" ? (
        <ul className="gutter__list" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="gutter__row gutter__row--pending">
              <span className="gutter__skel" />
            </li>
          ))}
        </ul>
      ) : null}

      {status === "error" ? (
        <p className="gutter__note">{error ?? (language === "ro" ? "Nu s-au putut calcula costurile marginale." : "Could not compute marginals.")}</p>
      ) : null}

      {status === "ready" ? (
        <ul className="gutter__list">
          {margins.length === 0 ? (
            <li className="gutter__note">{language === "ro" ? "Nu există exemple de afișat." : "No examples to show."}</li>
          ) : (
            margins.map((m, i) => (
              <li key={`${m.day}-${m.period}-${m.skill}`}>
                <button
                  type="button"
                  className={
                    m.binding
                      ? "gutter__row gutter__row--binding"
                      : "gutter__row"
                  }
                  onClick={() => setSelected(i === selected ? null : i)}
                  aria-pressed={i === selected}
                >
                  <span className="gutter__when">
                    D{m.day + 1} {periodClock(m.period)}
                  </span>
                  <span className="gutter__skill">{m.skill}</span>
                  <span className="gutter__delta num">
                    {points(m.delta)} {language === "ro" ? "pct." : "pts"}
                  </span>
                  <span
                    className="gutter__tag"
                    data-prov={m.provenance}
                    title={language === "ro" ? "Originea valorii duale LP, diferită de costul afișat" : "LP dual provenance — not the displayed monetary quote"}
                  >
                    {m.provenance}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {active ? (
        <div className="gutter__detail">
          <p>{language === "ro" ? `Necesarul de ${active.skill} din ziua ${active.day + 1}, ora ${periodClock(active.period)}, schimbă scorul cu ${points(active.delta)} puncte. Nu este o cheltuială.` : `Extra ${active.skill} demand on day ${active.day + 1} at ${periodClock(active.period)} changes the solver score by ${points(active.delta)} points. This is not a business expense.`}</p>
          <p className="gutter__caveat">
            {language === "ro" ? "Diferență prin recalculare exactă. Valoarea duală LP a fost " : "Exact re-solve Δ. LP dual at this row was "}
            <span className="num">{active.provenance}</span>
            {active.provenance === "degenerate"
              ? language === "ro" ? " — mărimea și ordinea nu sunt sigure; costul de mai sus provine din recalculare." : " — magnitude and rank unreliable; the amount above is from perturbation, not the dual."
              : language === "ro" ? " — valorile duale sunt orientative pentru programul fixat, fără garanție MILP." : " — duals are local guidance at the fixed integer roster, not a MILP guarantee."}
          </p>
        </div>
      ) : null}

      {status === "ready" && !exact ? (
        <p className="gutter__note">
          {language === "ro" ? "Intervalele au fost selectate cu dualul relaxat, apoi evaluate prin recalculare exactă; ordinea nu reprezintă cele mai costisitoare constrângeri." : "Sampled by relaxation dual, then priced by exact re-solve — not a ranking of the most expensive constraints."}
          {note && language !== "ro" ? ` ${note}` : ""}
        </p>
      ) : null}

      {status === "ready" && exact && note ? (
        <p className="gutter__note">{language === "ro" ? "Costurile sunt calculate prin rezolvări suplimentare ale programului." : note}</p>
      ) : null}
    </aside>
  );
}
