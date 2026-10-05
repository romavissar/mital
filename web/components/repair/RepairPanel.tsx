
import { useMemo, useState } from "react";

import { wipeAvailability } from "@/lib/instance-utils";
import type { Instance, Solution } from "@/lib/types";
import { t, useLanguage } from "@/lib/i18n";

type Props = {
  instance: Instance;
  published: Solution | null;
  busy?: boolean;
  onRepair: (nextInstance: Instance) => void;
};

export function RepairPanel({
  instance,
  published,
  busy,
  onRepair,
}: Props) {
  const language = useLanguage();
  const tr = (english: string) => t(language, english);
  const [employeeId, setEmployeeId] = useState(
    instance.employees[0]?.id ?? "",
  );
  const [days, setDays] = useState<number[]>([]);

  const emp = useMemo(
    () => instance.employees.find((e) => e.id === employeeId),
    [instance.employees, employeeId],
  );

  function toggleDay(d: number) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }

  function run() {
    if (!employeeId || days.length === 0) return;
    onRepair(wipeAvailability(instance, employeeId, days));
  }

  return (
    <div className="mgr-panel">
      <div className="mgr-panel__head">
        <div>
          <p className="label">{tr("Repair")}</p>
          <h2 className="mgr-panel__title">{tr("Minimal-disruption re-solve")}</h2>
        </div>
        <button
          type="button"
          className="mgr-btn mgr-btn--primary"
          disabled={busy || !published || days.length === 0 || !employeeId}
          onClick={run}
        >
          {busy ? tr("Repairing…") : tr("Repair roster")}
        </button>
      </div>

      {!published ? (
        <p className="mgr-hint" data-tone="alarm">
          {language === "ro" ? "Publicați mai întâi un program sau folosiți calculul curent ca bază. Ajustarea păstrează cât mai multe ture existente." : "Publish a roster first (or keep the current solve as the baseline). Repair stays close to the published assignments."}
        </p>
      ) : null}

      <label className="mgr-field">
        <span className="label">{tr("Employee unavailable")}</span>
        <select
          value={employeeId}
          onChange={(ev) => setEmployeeId(ev.target.value)}
        >
          {instance.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.id})
            </option>
          ))}
        </select>
      </label>

      <fieldset className="mgr-fieldset">
        <legend className="label">{tr("Days off")}</legend>
        <div className="mgr-chips">
          {Array.from({ length: instance.horizon_days }, (_, d) => (
            <label key={d} className="mgr-chip">
              <input
                type="checkbox"
                checked={days.includes(d)}
                onChange={() => toggleDay(d)}
              />
              {tr("Day")} {d + 1}
            </label>
          ))}
        </div>
      </fieldset>

      {emp ? (
        <p className="mgr-hint">
          {language === "ro" ? `Șterge disponibilitatea lui ${emp.name} în zilele selectate, apoi recalculează programul păstrând pe cât posibil turele publicate. Modificările sunt evidențiate în grilă.` : `Clears ${emp.name}'s availability on the selected days, then re-optimizes with stability toward the published roster. Changed cells highlight in dusk on the grid.`}
        </p>
      ) : null}
    </div>
  );
}
