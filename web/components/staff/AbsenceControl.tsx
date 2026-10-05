import { useState } from "react";

import type { Instance } from "@/lib/types";
import { useLanguage } from "@/lib/i18n";

type Reason = "sick" | "out" | null;

export function AbsenceControl({ instance, employeeId, busy, onChange }: {
  instance: Instance;
  employeeId: string;
  busy?: boolean;
  onChange: (employeeId: string, day: number, reason: Reason) => void;
}) {
  const language = useLanguage();
  const [day, setDay] = useState(0);
  const employee = instance.employees.find((item) => item.id === employeeId);
  const reason = employee?.absences?.find((item) => item.day === day)?.reason;
  const dateLabel = (index: number) => {
    const date = new Date(`${instance.start_date}T12:00:00`);
    date.setDate(date.getDate() + index);
    return new Intl.DateTimeFormat(language === "ro" ? "ro-RO" : "en-GB", { weekday: "short", day: "numeric", month: "short" }).format(date);
  };
  return <div className="mital-absence">
    <label className="mgr-field"><span className="label">{language === "ro" ? "Absent în ziua" : "Absent on"}</span>
      <select value={day} onChange={(event) => setDay(Number(event.target.value))}>
        {Array.from({ length: instance.horizon_days }, (_, index) => <option key={index} value={index}>{dateLabel(index)}</option>)}
      </select>
    </label>
    <div className="mgr-panel__actions">
      <button type="button" className="mgr-btn" data-active={reason === "sick" || undefined} disabled={busy} onClick={() => onChange(employeeId, day, "sick")}>{language === "ro" ? "Bolnav" : "Sick"}</button>
      <button type="button" className="mgr-btn" data-active={reason === "out" || undefined} disabled={busy} onClick={() => onChange(employeeId, day, "out")}>{language === "ro" ? "Absent" : "Out"}</button>
      {reason ? <button type="button" className="mital-text-action" disabled={busy} onClick={() => onChange(employeeId, day, null)}>{language === "ro" ? "Anulează absența" : "Clear absence"}</button> : null}
    </div>
    {reason ? <p className="mgr-hint" role="status">{language === "ro" ? "Această persoană nu va fi programată în ziua selectată." : "This person will not be scheduled on the selected day."}</p> : null}
  </div>;
}
