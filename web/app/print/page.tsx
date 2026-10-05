
import { useEffect, useState } from "react";

import type { Instance, Solution } from "@/lib/types";
import { formatMoney, isCurrency, rateNote, type CurrencySettings } from "@/lib/currency";
import { t } from "@/lib/i18n";

type PrintPayload = {
  instance: Instance;
  solution: Solution;
  settings: CurrencySettings;
  business_name?: string;
};

const DAY_NAMES = { en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], ro: ["Lun", "Mar", "Mie", "Joi", "Vin", "Sâm", "Dum"] };

export default function PrintPage() {
  const [data, setData] = useState<PrintPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.mital) {
      setError("Open Print from the desktop app.");
      return;
    }
    window.mital.getPrintPayload()
      .then((payload) => setData(payload))
      .catch(() => setError("Could not open the schedule for printing."));
  }, []);

  useEffect(() => {
    if (!data) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [data]);

  if (error) {
    return (
      <main className="print-sheet">
        <p className="mgr-hint" data-tone="alarm">
          {error}
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="print-sheet">
        <p className="mgr-hint">Preparing print…</p>
      </main>
    );
  }

  const { instance, solution, settings, business_name: businessName } = data;
  const language = settings.language;
  const tr = (english: string) => t(language, english);
  if (!isCurrency(instance.currency)) return <main className="print-sheet">{tr("Unsupported accounting currency")}: {instance.currency}</main>;
  const shiftById = new Map(instance.shifts.map((s) => [s.id, s]));
  const byEmp = new Map<string, Map<number, string[]>>();
  for (const a of solution.assignments) {
    const row = byEmp.get(a.employee) ?? new Map();
    const list = row.get(a.day) ?? [];
    const label = shiftById.get(a.shift)?.label ?? a.shift;
    list.push(label);
    row.set(a.day, list);
    byEmp.set(a.employee, row);
  }
  const hours = new Map(
    solution.per_employee.map((p) => [p.employee, p.hours]),
  );

  return (
    <main className="print-sheet">
      <header className="print-sheet__head">
        <div className="print-sheet__top"><div className="print-sheet__brand"><img src="./brand/mital-mark.png" alt="" /><span>mital</span></div><span className="print-sheet__eyebrow">{language === "ro" ? "Programul săptămânii" : "Weekly schedule"}</span></div>
        <div className="print-sheet__title"><div><h1>{businessName || instance.id}</h1><p>{tr("week of")} {new Intl.DateTimeFormat(language === "ro" ? "ro-RO" : "en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${instance.start_date}T12:00:00Z`))}</p></div><div className="print-sheet__pay"><span>{tr("Estimated pay")}</span><strong>{formatMoney(solution.objective.wages + solution.objective.overtime, instance.currency, settings)}</strong></div></div>
      </header>

      <table className="print-table">
        <thead>
          <tr>
            <th scope="col">{tr("Staff")}</th>
            {Array.from({ length: instance.horizon_days }, (_, d) => (
              <th key={d} scope="col">
                {DAY_NAMES[language][d % 7] ?? `D${d + 1}`}<small>{new Intl.DateTimeFormat(language === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.parse(`${instance.start_date}T12:00:00Z`) + d * 86400000))}</small>
              </th>
            ))}
            <th scope="col">{tr("Hours")}</th>
          </tr>
        </thead>
        <tbody>
          {instance.employees.map((e) => (
            <tr key={e.id}>
              <th scope="row">{e.name}</th>
              {Array.from({ length: instance.horizon_days }, (_, d) => (
                <td key={d}>
                  {(byEmp.get(e.id)?.get(d) ?? []).map((label, index) => <span className="print-shift" key={`${label}-${index}`}>{label}</span>)}{!byEmp.get(e.id)?.get(d)?.length ? "—" : null}
                </td>
              ))}
              <td className="num">{(hours.get(e.id) ?? 0).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="print-sheet__foot">{tr("Accounting currency")}: {instance.currency}. {language === "ro" ? instance.pay_basis === "monthly_salary" ? "Costul estimat include o cotă din salariile lunare și ore suplimentare. Nu este stat de plată. " : "Costul estimat include salariile orare și ore suplimentare. Nu este stat de plată. " : instance.pay_basis === "monthly_salary" ? "Estimated cost includes a share of monthly salaries and overtime. This is not payroll. " : "Estimated cost includes hourly wages and overtime. This is not payroll. "}{rateNote(instance.currency, settings)}</p>
    </main>
  );
}
