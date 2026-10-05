import { useMemo } from "react";

import { useLanguage } from "@/lib/i18n";
import type { Instance, Solution } from "@/lib/types";

export function CoverOptions({ instance, solution, busy, onConfirm }: {
  instance: Instance;
  solution: Solution;
  busy: boolean;
  onConfirm: (employeeId: string, day: number, shiftId: string) => void;
}) {
  const language = useLanguage();
  const gaps = useMemo(() => instance.shifts.flatMap((shift) =>
    Array.from({ length: instance.horizon_days }, (_, day) => ({ shift, day })).filter(({ shift, day }) =>
      instance.demand.some((item) => item.day === day && item.required > 0 && item.period >= shift.start_period && item.period < shift.end_period)
      && !solution.assignments.some((item) => item.day === day && item.shift === shift.id))), [instance, solution]);
  if (!gaps.length) return null;
  const hours = new Map(solution.per_employee.map((item) => [item.employee, item.hours]));
  const date = (day: number) => {
    const value = new Date(`${instance.start_date}T12:00:00`);
    value.setDate(value.getDate() + day);
    return new Intl.DateTimeFormat(language === "ro" ? "ro-RO" : "en-GB", { weekday: "long", day: "numeric", month: "short" }).format(value);
  };
  return <section className="schedule-cover" aria-label={language === "ro" ? "Acoperirea turelor" : "Shift cover"}>
    <div><strong>{language === "ro" ? "Ture care au nevoie de înlocuitor" : "Shifts needing cover"}</strong>
      <p>{language === "ro" ? "Replanificarea a verificat personalul disponibil. Confirmați disponibilitatea unei alte persoane pentru a reface programul." : "The roster has checked available staff. Confirm another person’s availability to rebuild it."}</p></div>
    {gaps.map(({ day, shift }) => {
      const candidates = instance.employees.filter((employee) =>
        !employee.absences?.some((item) => item.day === day)
        && !employee.skills.includes(instance.supervisor_skill)
        && !employee.availability.some((item) => item.day === day && item.shifts.includes(shift.id))
        && !solution.assignments.some((item) => item.day === day && item.employee === employee.id)
        && (hours.get(employee.id) ?? 0) + shift.paid_hours <= employee.max_hours + employee.max_overtime
        && instance.demand.some((item) => item.day === day && item.required > 0 && item.period >= shift.start_period && item.period < shift.end_period && employee.skills.includes(item.skill)));
      return <div className="schedule-cover__shift" key={`${day}-${shift.id}`}>
        <div><b>{date(day)} · {shift.label}</b><span>{language === "ro" ? "Nimeni programat" : "Nobody scheduled"}</span></div>
        <div className="schedule-cover__actions">
          {candidates.length ? candidates.map((employee) => <button type="button" className="mgr-btn" key={employee.id} disabled={busy} onClick={() => onConfirm(employee.id, day, shift.id)}>{language === "ro" ? `Confirmă ${employee.name}` : `Confirm ${employee.name}`}</button>)
            : <span>{language === "ro" ? "Nu este afișat niciun înlocuitor direct; verificați disponibilitatea și limitele de ore." : "No direct replacement is listed; review staff availability and hour limits."}</span>}
        </div>
      </div>;
    })}
  </section>;
}
