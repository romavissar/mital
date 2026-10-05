
import type { Solution } from "@/lib/types";
import { formatMoney, rateNote, type Currency, type CurrencySettings } from "@/lib/currency";
import { t, useLanguage } from "@/lib/i18n";

type Props = {
  solution: Solution;
  accounting: Currency;
  settings: CurrencySettings;
  payBasis?: "hourly" | "monthly_salary";
  bindingCount?: number | null;
};

export function SolveInspector({
  solution,
  accounting,
  settings,
  payBasis = "hourly",
  bindingCount = null,
}: Props) {
  const language = useLanguage();
  const tr = (english: string) => t(language, english);
  const o = solution.objective;
  const pay = o.wages + o.overtime;
  const points = (value: number) => new Intl.NumberFormat(language === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 0 }).format(value);
  const penalties = [
    { label: "Understaffing", value: o.understaffing },
    { label: "Supervisor", value: o.supervisor_penalty },
    { label: "Min hours", value: o.min_hours_penalty },
    { label: "Unfairness", value: o.unfairness },
    { label: "Preference", value: o.preference },
  ];

  return (
    <section className="inspector" aria-label="Solve inspector">
      <p className="label">{language === "ro" ? "Costul personalului" : "Staff cost"}</p>
      <strong className="inspector__pay num">{formatMoney(pay, accounting, settings)}</strong>
      <p className="mgr-hint">{language === "ro" ? "Estimare pentru această săptămână: salarii sau tarife și ore suplimentare. Nu este stat de plată." : "Estimated wages or salary share plus overtime for this week. This is not payroll."}</p>
      <dl className="inspector__pay-breakdown">
        <div><dt>{tr(payBasis === "monthly_salary" ? "Salaries (period share)" : "Wages")}</dt><dd className="num">{formatMoney(o.wages, accounting, settings)}</dd></div>
        <div><dt>{tr("Overtime")}</dt><dd className="num">{formatMoney(o.overtime, accounting, settings)}</dd></div>
      </dl>
      {rateNote(accounting, settings) ? <p className="inspector__hint">{rateNote(accounting, settings)}</p> : null}
      <div className="inspector__score-intro"><p className="label">{language === "ro" ? "Scorul programului" : "Scheduling score"}</p><p className="mgr-hint">{language === "ro" ? "Algoritmul adaugă puncte de penalizare pentru lipsuri de personal, supraveghere, ore și preferințe. Acestea nu sunt cheltuieli reale." : "The solver adds penalty points for staffing gaps, supervision, hours and preferences. These are not business expenses."}</p></div>
      <table className="inspector__terms">
        <thead>
          <tr>
            <th scope="col">{tr("Term")}</th><th scope="col" className="num">{language === "ro" ? "Puncte" : "Points"}</th>
          </tr>
        </thead>
        <tbody>
          {penalties.map((term) => <tr key={term.label}><th scope="row">{tr(term.label)}</th><td className="num">{points(term.value)}</td></tr>)}
          <tr className="inspector__total">
            <th scope="row">{language === "ro" ? "Scor total" : "Total score"}</th>
            <td className="num">{points(o.total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mgr-hint">{language === "ro" ? "Scorul combină costul estimat cu penalizările. Comparați-l doar între variante cu aceleași setări." : "The score combines estimated pay and penalties. Compare it only across options with the same settings."}</p>
      {solution.uncovered_entry_count > 0 ? (
        <p className="inspector__alarm">
          {language === "ro" ? `${solution.uncovered_entry_count} cerințe de competență neîndeplinite · ${solution.shortfall_person_periods.toFixed(1)} intervale persoană lipsă` : `${solution.uncovered_entry_count} skill requirements short of staff · ${solution.shortfall_person_periods.toFixed(1)} person-periods short`}
        </p>
      ) : null}
      <details className="inspector__technical"><summary>{language === "ro" ? "Detalii tehnice" : "Technical details"}</summary>
        <dl className="inspector__meta">
          <div><dt>{tr("Status")}</dt><dd>{tr(solution.status)}</dd></div>
          <div><dt>{tr("MIP gap")}</dt><dd className="num">{(solution.mip_gap * 100).toFixed(2)}%</dd></div>
          <div><dt>{tr("Solve time")}</dt><dd className="num">{solution.solve_time_s.toFixed(2)}s</dd></div>
          <div><dt>{tr("Binding (gutter)")}</dt><dd className="num">{bindingCount ?? "—"}</dd></div>
        </dl>
        <p className="inspector__fair num">z {solution.fairness.max_deviation_hours.toFixed(2)} h · Gini {solution.fairness.gini.toFixed(3)} · Jain {solution.fairness.jain.toFixed(3)}</p>
      </details>
    </section>
  );
}
