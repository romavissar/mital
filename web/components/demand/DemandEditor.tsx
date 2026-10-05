
import { useState } from "react";

import {
  demandForShiftBand,
  setDemandForShiftBand,
} from "@/lib/instance-utils";
import type { Instance } from "@/lib/types";
import { t, useLanguage } from "@/lib/i18n";

type Props = {
  instance: Instance;
  onChange: (next: Instance) => void;
  onApply: () => void;
  busy?: boolean;
  hideApply?: boolean;
};

export function DemandEditor({ instance, onChange, onApply, busy, hideApply }: Props) {
  const language = useLanguage();
  const tr = (english: string) => t(language, english);
  const [day, setDay] = useState(0);
  const time = (period: number) => `${String(Math.floor(period / 4)).padStart(2, "0")}:${String((period % 4) * 15).padStart(2, "0")}`;

  function setRequired(skill: string, shiftId: string, required: number) {
    onChange(
      setDemandForShiftBand(
        instance,
        day,
        skill,
        shiftId,
        Math.max(0, Math.floor(required)),
      ),
    );
  }

  function copyFromPrev() {
    if (day === 0) return;
    let next = structuredClone(instance);
    for (const skill of instance.skills) {
      for (const sh of instance.shifts) {
        const r = demandForShiftBand(instance, day - 1, skill, sh.id);
        next = setDemandForShiftBand(next, day, skill, sh.id, r);
      }
    }
    onChange(next);
  }

  function clearDay() {
    const next = structuredClone(instance);
    next.demand = next.demand.filter((d) => d.day !== day);
    onChange(next);
  }

  return (
    <div className="mgr-panel">
      <div className="mgr-panel__head">
        <div>
          <p className="label">{tr("Demand")}</p>
          <h2 className="mgr-panel__title">{tr("Coverage by shift band")}</h2>
        </div>
        <div className="mgr-panel__actions">
          <button
            type="button"
            className="mgr-btn"
            disabled={day === 0}
            onClick={copyFromPrev}
          >
            {tr("Copy previous day")}
          </button>
          <button type="button" className="mgr-btn" onClick={clearDay}>
            {tr("Clear day")}
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

      <div className="mgr-tabs" role="tablist">
        {Array.from({ length: instance.horizon_days }, (_, d) => (
          <button
            key={d}
            type="button"
            role="tab"
            className="mgr-tabs__tab"
            aria-selected={d === day}
            data-active={d === day || undefined}
            onClick={() => setDay(d)}
          >
            {tr("Day")} {d + 1}
          </button>
        ))}
      </div>

      <p className="mgr-hint">{tr("Tinted cells have required staff; 0 means no demand.")}</p>
      <div className="mgr-demand" style={{ gridTemplateColumns: `minmax(170px, 1.2fr) repeat(${instance.skills.length}, minmax(120px, 1fr))` }}>
        <div className="mgr-demand__corner label">{tr("Shifts")}</div>
        {instance.skills.map((skill) => <div key={skill} className="label mgr-demand__head">{skill}{skill === instance.supervisor_skill ? " ★" : ""}</div>)}
        {instance.shifts.map((s) => (
          <div key={s.id} className="mgr-demand__row">
            <div className="mgr-demand__shift"><strong>{s.label}</strong><span className="num">{time(s.start_period)}–{time(s.end_period)}</span></div>
            {instance.skills.map((skill) => (
              <label key={skill} className="mgr-field mgr-demand__cell">
                <input
                  className="num"
                  type="number"
                  aria-label={`${skill} · ${s.label} · ${tr("Day")} ${day + 1}`}
                  min={0}
                  step={1}
                  value={demandForShiftBand(instance, day, skill, s.id)}
                  data-filled={demandForShiftBand(instance, day, skill, s.id) > 0 || undefined}
                  onChange={(ev) =>
                    setRequired(skill, s.id, Number(ev.target.value))
                  }
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <p className="mgr-hint">
        {language === "ro" ? "Numărul necesar de angajați se aplică fiecărui interval de 15 minute al turei. Prezența responsabilului (★) este calculată separat când firma este deschisă." : "Required headcount is written to every 15-minute period covered by that shift. Supervisor presence (★) is enforced separately by the model when the shop is open."}
      </p>
    </div>
  );
}
