import { useEffect, useMemo, useState } from "react";

import { availabilityIdeas, closesGaps, hiringNeeds, withAvailability, type AvailabilityIdea } from "@/lib/gap-advice";
import { solveInstance } from "@/lib/solver-client";
import type { Instance, Pin, Solution } from "@/lib/types";
import { t, useLanguage } from "@/lib/i18n";
import { shiftStaffingGaps } from "@/lib/coverage";
import { contractedCapacity } from "@/lib/capacity";

type TestedIdea = { idea: AvailabilityIdea; instance: Instance; solution: Solution; source: Solution };
type Props = {
  instance: Instance;
  solution: Solution;
  pins: Pin[];
  dismissed: Set<string>;
  onReject: (id: string) => void;
  onApply: (next: Instance, result: Solution) => void;
  onHire: (skill: string) => void;
  onReviewPerson: (id: string) => void;
};

export function GapAdvisor({ instance, solution, pins, dismissed, onReject, onApply, onHire, onReviewPerson }: Props) {
  const language = useLanguage();
  const tr = (english: string) => t(language, english);
  const [tested, setTested] = useState<TestedIdea[]>([]);
  const [searching, setSearching] = useState(false);
  const hires = useMemo(() => hiringNeeds(instance, solution), [instance, solution]);
  const surplus = useMemo(() => contractedCapacity(instance, solution), [instance, solution]);
  const belowMin = solution.per_employee.find((row) => row.hours + 1e-6 < (instance.employees.find((e) => e.id === row.employee)?.min_hours ?? 0));
  const thinShifts = shiftStaffingGaps(instance, solution);
  const firstGap = thinShifts[0];
  const showThin = !!firstGap && !dismissed.has("shift-staffing");
  const gapDate = firstGap && new Intl.DateTimeFormat(language === "ro" ? "ro-RO" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.parse(`${instance.start_date}T12:00:00Z`) + firstGap.day * 86400000));
  const time = (period: number) => `${String(Math.floor(period / 4)).padStart(2, "0")}:${String((period % 4) * 15).padStart(2, "0")}`;

  useEffect(() => {
    let active = true;
    const ideas = availabilityIdeas(instance, solution);
    setTested([]);
    setSearching(ideas.length > 0);
    void (async () => {
      let found = 0;
      for (const idea of ideas) {
        if (!active || found >= 2) break;
        const next = withAvailability(instance, idea);
        try {
          const result = await solveInstance(next, { time_limit_s: 5, pins });
          if (!active) break;
          if (closesGaps(solution, result, next)) {
            setTested((prev) => [...prev, { idea, instance: next, solution: result, source: solution }]);
            found++;
          }
        } catch { /* One scenario may fail; the hiring route still remains. */ }
      }
      if (active) setSearching(false);
    })();
    return () => { active = false; };
  }, [instance, solution, pins]);

  const visible = tested.filter(({ idea, source }) => source === solution && !dismissed.has(idea.id));
  const visibleHires = hires.filter((hire) => !dismissed.has(`hire:${hire.skill}`));
  const showSurplus = surplus && !dismissed.has("capacity");
  const showMinimum = belowMin && !surplus && !dismissed.has(`minimum:${belowMin.employee}`);
  if (!searching && !visible.length && !visibleHires.length && !showMinimum && !showThin && !showSurplus) return null;

  return <section className="mital-advisor mgr-panel" aria-label={tr("Ways to close gaps")}>
    <div className="mgr-panel__head"><div><p className="label">{tr("Coverage help")}</p><h2 className="mgr-panel__title">{tr("Ways to close gaps")}</h2></div></div>
    <p className="mgr-hint">{language === "ro" ? "Schimbările propuse sunt verificate cu algoritmul local. Confirmați disponibilitatea înainte de acceptare; problemele rămase apar mai jos." : "Suggestions are checked with the local solver. Confirm availability before accepting; remaining issues stay visible below."}</p>
    {searching ? <p className="mgr-hint" role="status">{tr("Checking options locally…")}</p> : null}
    <div className="mital-advisor__list">
      {showSurplus && surplus ? <article className="mital-advisor__item"><div><strong>{language === "ro" ? "Ore contractate peste capacitatea turelor" : "Contracted hours exceed shift capacity"}</strong>
        <p>{language === "ro" ? `${surplus.contractedHours.toFixed(1)} ore minime contractate, dar cel mult ${surplus.availableHours.toFixed(1)} ore în ture la limita de personal aleasă. Cel puțin ${surplus.excessHours.toFixed(1)} ore nu încap în program.` : `${surplus.contractedHours.toFixed(1)} minimum contracted hours, but at most ${surplus.availableHours.toFixed(1)} shift hours fit under the selected cap. At least ${surplus.excessHours.toFixed(1)} hours cannot be scheduled.`}</p>
        <p className="mgr-hint">{language === "ro" ? "Dacă situația se repetă, analizați numărul de angajați sau orele contractate. Economiile brute de mai jos sunt costul săptămânal actual al persoanei; economiile nete depind de acoperirea turelor rămase." : "If this recurs, review headcount or contracted hours. Gross savings below equal each person's current weekly pay cost; net savings depend on covering their remaining shifts."}</p>
        <p className="mgr-hint">{surplus.candidates.slice(0, 3).map((item) => `${item.name}: ${item.missing.toFixed(1)} h ${language === "ro" ? "sub minim" : "below minimum"} · ${language === "ro" ? "economie brută max." : "max gross saving"} ${instance.currency} ${item.grossWeeklySaving.toFixed(2)}`).join(" · ")}</p></div>
        <div className="mgr-panel__actions"><button className="mgr-btn" type="button" onClick={() => { if (surplus.candidates[0]) onReviewPerson(surplus.candidates[0].id); }} disabled={!surplus.candidates.length}>{language === "ro" ? "Verifică personalul" : "Review staff"}</button><button className="mgr-btn" type="button" onClick={() => onReject("capacity")}>{tr("Dismiss")}</button></div></article> : null}
      {showThin && firstGap ? <article className="mital-advisor__item"><div><strong>{gapDate} · {firstGap.shift.label} {time(firstGap.shift.start_period)}–{time(firstGap.shift.end_period)} · {firstGap.missing} {language === "ro" ? "persoane lipsă" : firstGap.missing === 1 ? "person missing" : "people missing"}</strong>
        <p className="mgr-hint">{language === "ro" ? "Disponibilitatea, competențele și limitele de ore introduse pentru angajați pot împiedica acoperirea acestei ture." : "Availability, skills, or the hours entered for staff may prevent this shift from being covered."}</p>
        </div>
        <div className="mgr-panel__actions"><button className="mgr-btn" type="button" onClick={() => onHire(instance.skills.find((skill) => skill !== instance.supervisor_skill) ?? instance.supervisor_skill)}>{language === "ro" ? "Adaugă un angajat real" : "Add a real employee"}</button><button className="mgr-btn" type="button" onClick={() => onReject("shift-staffing")}>{tr("Dismiss")}</button></div></article> : null}
      {visible.map(({ idea, instance: next, solution: result }) => {
        const employee = instance.employees.find((e) => e.id === idea.employee);
        const shift = instance.shifts.find((s) => s.id === idea.shift);
        return <article className="mital-advisor__item" key={idea.id}>
          <div><strong>{language === "ro" ? `Confirmați disponibilitatea lui ${employee?.name ?? idea.employee}` : `Confirm ${employee?.name ?? idea.employee}'s availability`}</strong>
            <p>{language === "ro" ? `Ziua ${idea.day + 1} · ${shift?.label ?? idea.shift} · ${idea.skill}` : `Day ${idea.day + 1} · ${shift?.label ?? idea.shift} · ${idea.skill}`}</p>
            <p className="mgr-hint">{language === "ro" ? `Cerințe de competență neîndeplinite: ${solution.uncovered_entry_count} → ${result.uncovered_entry_count}; fără responsabil: ${solution.objective.supervisor_gap} → ${result.objective.supervisor_gap}.` : `Skill requirements short of staff: ${solution.uncovered_entry_count} → ${result.uncovered_entry_count}; supervision gaps: ${solution.objective.supervisor_gap} → ${result.objective.supervisor_gap}.`}</p>
            </div>
        <div className="mgr-panel__actions"><button className="mgr-btn mgr-btn--primary" type="button" onClick={() => onApply(next, result)}>{tr("Accept & implement")}</button><button className="mgr-btn" type="button" onClick={() => onReject(idea.id)}>{tr("Dismiss")}</button></div>
        </article>;
      })}
      {visibleHires.map((hire) => <article className="mital-advisor__item" key={`hire:${hire.skill}`}><div><strong>{language === "ro" ? `Luați în calcul personal calificat pentru ${hire.skill}` : `Consider more ${hire.skill} cover`}</strong>
        <p>{language === "ro" ? `Aproximativ ${hire.hours} ore de personal cu această competență rămân neacoperite. Adăugați un angajat real sau organizați acoperire suplimentară.` : `About ${hire.hours} staff-hours needing this skill remain uncovered. Add a real employee or arrange additional cover.`}</p>
        <p className="mgr-hint">{language === "ro" ? "Necesarul estimat nu garantează că o singură angajare rezolvă toate intervalele." : "This estimate does not mean one hire will cover every period."}</p></div>
        <div className="mgr-panel__actions"><button className="mgr-btn" type="button" onClick={() => onHire(hire.skill)}>{language === "ro" ? "Adaugă un angajat real" : "Add a real employee"}</button><button className="mgr-btn" type="button" onClick={() => onReject(`hire:${hire.skill}`)}>{tr("Dismiss")}</button></div></article>)}
      {showMinimum ? <article className="mital-advisor__item"><div><strong>{language === "ro" ? `Verificați orele contractate pentru ${instance.employees.find((e) => e.id === belowMin.employee)?.name ?? belowMin.employee}` : `Review contracted hours for ${instance.employees.find((e) => e.id === belowMin.employee)?.name ?? belowMin.employee}`}</strong>
        <p className="mgr-hint">{language === "ro" ? "Verificați disponibilitatea și contractul înainte de recalculare; nu reducem automat orele minime." : "Check actual availability and the contract before rebuilding; minimum hours are not reduced automatically."}</p></div>
        <div className="mgr-panel__actions"><button className="mgr-btn" type="button" onClick={() => onReviewPerson(belowMin.employee)}>{tr("Accept & review person")}</button><button className="mgr-btn" type="button" onClick={() => onReject(`minimum:${belowMin.employee}`)}>{tr("Dismiss")}</button></div></article> : null}
    </div>
  </section>;
}
