import { useState } from "react";

import { clockPeriod, demandAfterShiftEdit } from "@/lib/business";
import { errorText, t, useLanguage } from "@/lib/i18n";
import type { Instance, Shift } from "@/lib/types";

type Row = { id: string; label: string; start: string; end: string; paid: string };
const clock = (period: number) => `${String(Math.floor(period / 4)).padStart(2, "0")}:${String((period % 4) * 15).padStart(2, "0")}`;

export function ShiftEditor({ instance, onApply }: { instance: Instance; onApply: (next: Instance) => void }) {
  const language = useLanguage();
  const tr = (english: string) => t(language, english);
  const [rows, setRows] = useState<Row[]>(() => instance.shifts.map((shift) => ({
    id: shift.id, label: shift.label, start: clock(shift.start_period), end: clock(shift.end_period), paid: String(shift.paid_hours),
  })));
  const [error, setError] = useState<string | null>(null);
  const update = (id: string, patch: Partial<Row>) => setRows((old) => old.map((row) => row.id === id ? { ...row, ...patch } : row));

  function apply() {
    try {
      if (!rows.length) throw new Error("Add at least one shift.");
      if (rows.some((row) => !row.label.trim()) || new Set(rows.map((row) => row.label.trim())).size !== rows.length) throw new Error("Name every shift distinctly.");
      const shifts: Shift[] = rows.map((row) => ({
        ...instance.shifts.find((shift) => shift.id === row.id),
        id: row.id, label: row.label.trim(), start_period: clockPeriod(row.start), end_period: clockPeriod(row.end),
        paid_hours: Number(row.paid), undesirable: instance.shifts.find((shift) => shift.id === row.id)?.undesirable ?? false,
        closing: instance.shifts.find((shift) => shift.id === row.id)?.closing ?? false,
      }));
      for (const shift of shifts) {
        if (shift.end_period <= shift.start_period || shift.paid_hours <= 0 || shift.paid_hours > (shift.end_period - shift.start_period) / 4) {
          throw new Error(`Check the times and paid hours for ${shift.label}.`);
        }
      }
      const changed = JSON.stringify(shifts) !== JSON.stringify(instance.shifts);
      const ids = new Set(shifts.map((shift) => shift.id));
      onApply({ ...instance, shifts, demand: changed ? demandAfterShiftEdit(instance, shifts) : instance.demand,
        employees: instance.employees.map((employee) => ({ ...employee,
          availability: employee.availability.map((entry) => ({ ...entry, shifts: entry.shifts.filter((id) => ids.has(id)) })),
          preferences: employee.preferences.filter((entry) => ids.has(entry.shift)),
        })) });
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return <section className="mgr-panel">
    <div className="mgr-panel__head"><div><p className="label">{tr("Shifts")}</p><h2 className="mgr-panel__title">{tr("Opening hours and shifts")}</h2></div>
      <button type="button" className="mgr-btn mgr-btn--primary" onClick={apply}>{tr("Apply shifts")}</button></div>
    <p className="mgr-hint">{language === "ro" ? "Dacă mutați toate turele cu același interval, necesarul se mută odată cu ele. Alte modificări ale orelor șterg necesarul; verificați apoi Personal și Necesarul." : "Moving every shift by the same amount moves demand with it. Other time changes clear demand; then check People and Demand."}</p>
    {rows.map((row) => <div className="mgr-form__row" key={row.id}>
      <label className="mgr-field"><span className="label">{tr("Shift name")}</span><input value={row.label} onChange={(event) => update(row.id, { label: event.target.value })} /></label>
      <label className="mgr-field"><span className="label">{tr("Start")}</span><input type="time" step="900" value={row.start} onChange={(event) => update(row.id, { start: event.target.value })} /></label>
      <label className="mgr-field"><span className="label">{language === "ro" ? "Sfârșit (24:00 = miezul nopții)" : "End (24:00 = midnight)"}</span><input type="text" inputMode="numeric" maxLength={5} placeholder="HH:MM" value={row.end} onChange={(event) => update(row.id, { end: event.target.value })} /></label>
      <label className="mgr-field"><span className="label">{tr("Paid hours")}</span><input type="number" min="0.25" step="0.25" value={row.paid} onChange={(event) => update(row.id, { paid: event.target.value })} /></label>
      <button type="button" className="mgr-btn" disabled={rows.length === 1} onClick={() => setRows((old) => old.filter((item) => item.id !== row.id))}>{tr("Remove")}</button>
    </div>)}
    <div><button type="button" className="mgr-btn" onClick={() => {
      let index = 1; while (rows.some((row) => row.id === `shift_${index}`)) index++;
      setRows([...rows, { id: `shift_${index}`, label: `${language === "ro" ? "Tură" : "Shift"} ${index}`, start: "17:00", end: "22:00", paid: "5" }]);
    }}>{tr("Add shift")}</button></div>
    {error ? <p className="mgr-hint" data-tone="alarm">{errorText(language, error)}</p> : null}
  </section>;
}
