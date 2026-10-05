
import { useMemo, useState } from "react";

import { nextEmployeeId } from "@/lib/instance-utils";
import type { Employee, Instance } from "@/lib/types";
import { formatMoney, isCurrency, type CurrencySettings } from "@/lib/currency";
import { t, useLanguage } from "@/lib/i18n";
import { AbsenceControl } from "@/components/staff/AbsenceControl";

type Props = {
  instance: Instance;
  onChange: (next: Instance) => void;
  onApply: () => void;
  busy?: boolean;
  hideApply?: boolean;
  settings: CurrencySettings;
  initialSelected?: string | null;
  suggestedSkill?: string | null;
  onDismissSuggestedSkill?: () => void;
  onAbsence?: (employeeId: string, day: number, reason: "sick" | "out" | null) => void;
};

const emptyEmp = (inst: Instance, language: "ro" | "en"): Employee => ({
  id: nextEmployeeId(inst),
  name: language === "ro" ? "Angajat nou" : "New hire",
  wage: 14,
  ot_wage: 21,
  monthly_salary: null,
  skills: [inst.skills[0] ?? "staff"],
  min_hours: 0,
  max_hours: 40,
  max_overtime: 8,
  availability: Array.from({ length: inst.horizon_days }, (_, day) => ({
    day,
    shifts: inst.shifts.map((s) => s.id),
  })),
  preferences: [],
});

export function StaffEditor({ instance, onChange, onApply, busy, hideApply, settings, initialSelected, suggestedSkill, onDismissSuggestedSkill, onAbsence }: Props) {
  const language = useLanguage();
  const tr = (english: string) => t(language, english);
  const time = (period: number) => `${String(Math.floor(period / 4)).padStart(2, "0")}:${String(period % 4 * 15).padStart(2, "0")}`;
  const accounting = isCurrency(instance.currency) ? instance.currency : "EUR";
  const salaried = instance.pay_basis === "monthly_salary";
  const [selected, setSelected] = useState<string | null>(
    initialSelected ?? instance.employees[0]?.id ?? null,
  );
  const [search, setSearch] = useState("");

  const emp = useMemo(
    () => instance.employees.find((e) => e.id === selected) ?? null,
    [instance.employees, selected],
  );

  function updateEmp(id: string, patch: Partial<Employee>) {
    const next = structuredClone(instance);
    const i = next.employees.findIndex((e) => e.id === id);
    if (i < 0) return;
    next.employees[i] = { ...next.employees[i], ...patch };
    onChange(next);
  }

  function toggleSkill(id: string, skill: string) {
    const e = instance.employees.find((x) => x.id === id);
    if (!e) return;
    const has = e.skills.includes(skill);
    const skills = has
      ? e.skills.filter((s) => s !== skill)
      : [...e.skills, skill];
    if (skills.length === 0) return;
    updateEmp(id, { skills });
  }

  function toggleAvail(id: string, day: number, shiftId: string) {
    const e = instance.employees.find((x) => x.id === id);
    if (!e) return;
    const avail = e.availability.map((a) => ({ ...a, shifts: [...a.shifts] }));
    let row = avail.find((a) => a.day === day);
    if (!row) {
      row = { day, shifts: [] };
      avail.push(row);
    }
    if (row.shifts.includes(shiftId)) {
      row.shifts = row.shifts.filter((s) => s !== shiftId);
    } else {
      row.shifts.push(shiftId);
    }
    updateEmp(id, {
      availability: avail.filter((a) => a.shifts.length > 0 || a.day === day),
    });
  }

  function addStaff() {
    const next = structuredClone(instance);
    const neu = emptyEmp(next, language);
    if (suggestedSkill && next.skills.includes(suggestedSkill)) {
      neu.skills = [suggestedSkill];
      neu.availability = [];
      onDismissSuggestedSkill?.();
    }
    next.employees.push(neu);
    onChange(next);
    setSelected(neu.id);
  }

  function archiveStaff(id: string) {
    // Soft archive: clear availability (still in file for history-ish).
    updateEmp(id, { availability: [] });
  }

  function removeStaff(id: string) {
    if (!window.confirm(tr("Remove this employee from the current business?"))) return;
    const next = structuredClone(instance);
    next.employees = next.employees.filter((e) => e.id !== id);
    onChange(next);
    setSelected(next.employees[0]?.id ?? null);
  }

  return (
    <div className="mgr-panel">
      {suggestedSkill ? <div className="mital-hire-note"><div><strong>{language === "ro" ? `Acoperire necesară: ${suggestedSkill}` : `Coverage needed: ${suggestedSkill}`}</strong><p className="mgr-hint">{language === "ro" ? "Adăugați o persoană reală, confirmați plata și disponibilitatea, apoi recalculați. Nicio angajare nu este creată automat." : "Add a real person, confirm pay and availability, then rebuild. No hire is created automatically."}</p></div><button type="button" className="mital-text-action" onClick={onDismissSuggestedSkill}>{tr("Dismiss")}</button></div> : null}
      <div className="mgr-panel__head">
        <div>
          <p className="label">{tr("Staff")}</p>
          <h2 className="mgr-panel__title">{tr("People & availability")}</h2>
        </div>
        <div className="mgr-panel__actions">
          <button type="button" className="mgr-btn" onClick={addStaff}>
            {tr("Add staff")}
          </button>
          {!hideApply ? <button
            type="button"
            className="mgr-btn mgr-btn--primary"
            disabled={busy}
            onClick={onApply}
          >
            {busy ? tr("Solving…") : tr("Apply & re-solve")}
          </button> : null}
        </div>
      </div>

      <div className="mgr-split">
        <div><label className="mgr-field"><span className="label">{tr("Find staff")}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr("Search by name")} /></label>
        <ul className="mgr-list">
          {instance.employees.filter((e) => e.name.toLocaleLowerCase(language).includes(search.toLocaleLowerCase(language))).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="mgr-list__item"
                data-active={e.id === selected || undefined}
                onClick={() => setSelected(e.id)}
              >
                <span>{e.name}</span>
                <span className="num">{salaried
                  ? e.monthly_salary == null ? tr("Set salary") : `${formatMoney(e.monthly_salary, accounting, settings)}/${language === "ro" ? "lună" : "mo"}`
                  : formatMoney(e.wage, accounting, settings)}</span>
              </button>
            </li>
          ))}
        </ul></div>

        {emp ? (
          <div className="mgr-form">
            {salaried && (!emp.monthly_salary || emp.monthly_salary <= 0) ? <p className="mgr-hint" data-tone="alarm">{tr("Enter a monthly salary to continue.")}</p> : null}
            {!salaried && emp.ot_wage < emp.wage ? <p className="mgr-hint" data-tone="alarm">{tr("Extra overtime cost must be at least the hourly wage for every employee.")}</p> : null}
            {!emp.availability.some((day) => day.shifts.length) ? <p className="mgr-hint" data-tone="alarm">{tr("Select at least one available shift.")}</p> : null}
            <label className="mgr-field">
              <span className="label">{tr("Name")}</span>
              <input
                value={emp.name}
                onChange={(ev) => updateEmp(emp.id, { name: ev.target.value })}
              />
            </label>
            <div className="mgr-form__row">
              {salaried ? (
                <label className="mgr-field">
                  <span className="label">{tr("Monthly salary")} ({accounting})</span>
                  <input className="num" type="number" step="0.01" min={0.01} value={emp.monthly_salary ?? ""} onChange={(ev) => updateEmp(emp.id, { monthly_salary: ev.target.value === "" ? null : Number(ev.target.value) })} />
                </label>
              ) : (
                <label className="mgr-field">
                  <span className="label">{tr("Wage / hour")} ({accounting})</span>
                  <input className="num" type="number" step="0.01" min={0.01} value={emp.wage} onChange={(ev) => updateEmp(emp.id, { wage: Number(ev.target.value) })} />
                </label>
              )}
              <label className="mgr-field">
                <span className="label">{tr("Extra overtime cost / hour")} ({accounting})</span>
                <input
                  className="num"
                  type="number"
                  step="0.01"
                  min={0.01}
                  value={emp.ot_wage}
                  onChange={(ev) =>
                    updateEmp(emp.id, { ot_wage: Number(ev.target.value) })
                  }
                />
              </label>
            </div>

            <div className="mgr-form__row">
              <label className="mgr-field">
                <span className="label">{tr("Min h")}</span>
                <input
                  className="num"
                  type="number"
                  min={0}
                  value={emp.min_hours}
                  onChange={(ev) =>
                    updateEmp(emp.id, { min_hours: Number(ev.target.value) })
                  }
                />
              </label>
              <label className="mgr-field">
                <span className="label">{tr("Max h")}</span>
                <input
                  className="num"
                  type="number"
                  min={0}
                  value={emp.max_hours}
                  onChange={(ev) =>
                    updateEmp(emp.id, { max_hours: Number(ev.target.value) })
                  }
                />
              </label>
              <label className="mgr-field">
                <span className="label">{tr("Max OT")}</span>
                <input
                  className="num"
                  type="number"
                  min={0}
                  value={emp.max_overtime}
                  onChange={(ev) =>
                    updateEmp(emp.id, {
                      max_overtime: Number(ev.target.value),
                    })
                  }
                />
              </label>
            </div>

            <fieldset className="mgr-fieldset">
              <legend className="label">{tr("Skills")}</legend>
              <div className="mgr-chips">
                {instance.skills.map((sk) => (
                  <label key={sk} className="mgr-chip">
                    <input
                      type="checkbox"
                      checked={emp.skills.includes(sk)}
                      onChange={() => toggleSkill(emp.id, sk)}
                    />
                    {sk}
                    {sk === instance.supervisor_skill ? " ★" : ""}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mgr-fieldset">
              <legend className="label">{tr("Availability")}</legend>
              <div className="mgr-avail" style={{ gridTemplateColumns: `48px repeat(${instance.shifts.length}, minmax(116px, 1fr))` }}>
                <div className="mgr-avail__corner" />
                {instance.shifts.map((s) => (
                  <div key={s.id} className="label mgr-avail__head">
                    {s.label}<small className="num">{time(s.start_period)}–{time(s.end_period)}</small>
                  </div>
                ))}
                {Array.from({ length: instance.horizon_days }, (_, day) => (
                  <div key={day} className="mgr-avail__row">
                    <div className="label">D{day + 1}</div>
                    {instance.shifts.map((s) => {
                      const on =
                        emp.availability
                          .find((a) => a.day === day)
                          ?.shifts.includes(s.id) ?? false;
                      return (
                        <label key={s.id} className="mgr-avail__cell">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              toggleAvail(emp.id, day, s.id)
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </fieldset>

            {onAbsence ? <AbsenceControl key={emp.id} instance={instance} employeeId={emp.id} busy={busy} onChange={onAbsence} /> : null}

            <div className="mgr-panel__actions">
              <button
                type="button"
                className="mgr-btn"
                onClick={() => archiveStaff(emp.id)}
              >
                {tr("Clear availability")}
              </button>
              <button
                type="button"
                className="mgr-btn"
                data-tone="alarm"
                onClick={() => removeStaff(emp.id)}
              >
                {tr("Remove")}
              </button>
            </div>
          </div>
        ) : (
          <p className="mgr-empty">{tr("Add staff to edit.")}</p>
        )}
      </div>
    </div>
  );
}
