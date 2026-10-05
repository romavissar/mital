
import type { Instance, Pin, Solution } from "@/lib/types";
import { t, useLanguage, type Language } from "@/lib/i18n";
import { emptyOpenPeriods, shiftsBelowMinimum } from "@/lib/coverage";

export type ChecklistItem = {
  id: string;
  ok: boolean;
  label: string;
  kind?: "warning" | "hard" | "gap";
};

type Props = {
  instance: Instance;
  solution: Solution | null;
  pins: Pin[];
  published: boolean;
  toast: string | null;
  busy?: boolean;
  onPublish: () => void;
  onPrint: () => void;
  onExportCsv: () => void;
  onEdit: (area: "schedule" | "staff" | "shifts") => void;
  needsBuild: boolean;
};

export function buildChecklist(
  instance: Instance,
  solution: Solution | null,
  pins: Pin[],
  language: Language = "en",
): ChecklistItem[] {
  const tr = (english: string) => t(language, english);
  if (!solution) {
    return [
      { id: "sol", ok: false, kind: "hard", label: tr("No solution yet — solve first") },
    ];
  }
  const belowMin = solution.per_employee.filter((p) => {
    const e = instance.employees.find((x) => x.id === p.employee);
    return e != null && p.hours + 1e-6 < e.min_hours;
  });
  const empty = emptyOpenPeriods(instance, solution).size;
  const thinShifts = shiftsBelowMinimum(instance, solution);
  return [
    {
      id: "status", kind: "hard", ok: solution.status === "optimal" || solution.status === "feasible",
      label: language === "ro" ? `Stare calcul: ${tr(solution.status)}` : `Solver status: ${solution.status}`,
    },
    {
      id: "empty",
      kind: "hard",
      ok: empty === 0,
      label: empty === 0 ? (language === "ro" ? "Niciun interval fără personal" : "No periods without staff")
        : language === "ro" ? `${empty} intervale deschise fără niciun angajat` : `${empty} open periods with nobody working`,
    },
    {
      id: "shift-min", kind: "hard", ok: thinShifts === 0,
      label: thinShifts === 0 ? (language === "ro" ? "Minimul de personal este îndeplinit pe fiecare tură" : "Every shift meets its staffing minimum")
        : language === "ro" ? `${thinShifts} ${thinShifts === 1 ? "tură sub" : "ture sub"} minimul de personal` : `${thinShifts} ${thinShifts === 1 ? "shift" : "shifts"} below the staffing minimum`,
    },
    {
      id: "sup",
      kind: instance.rules.supervision_required === false || instance.rules.max_people_per_shift === 1 ? "warning" : "hard",
      ok: solution.objective.supervisor_gap === 0,
      label:
        instance.rules.supervision_required === false || instance.rules.max_people_per_shift === 1
          ? (language === "ro" ? "Supravegherea angajaților este opțională" : "Employee supervision is optional")
          : solution.objective.supervisor_gap === 0
          ? (language === "ro" ? "Angajații sunt supravegheați când este necesar" : "Staff have supervision when required")
          : language === "ro" ? `${solution.objective.supervisor_gap} intervale cu angajați fără responsabil` : `${solution.objective.supervisor_gap} staffed periods needing a supervisor`,
    },
    {
      id: "min",
      kind: "gap",
      ok: belowMin.length === 0,
      label:
        belowMin.length === 0
          ? tr("Everyone at or above contracted minimum")
          : language === "ro" ? `${belowMin.length} angajați sub minimul contractat` : `${belowMin.length} staff below contracted minimum`,
    },
    {
      id: "pins", kind: "warning",
      ok: true,
      label:
        pins.length === 0
          ? tr("No manager pins")
          : language === "ro" ? `${pins.length} ture fixate` : `${pins.length} pin${pins.length === 1 ? "" : "s"} active`,
    },
  ];
}

export function PublishChecklist({
  instance,
  solution,
  pins,
  published,
  toast,
  busy,
  onPublish,
  onPrint,
  onExportCsv,
  onEdit,
  needsBuild,
}: Props) {
  const language = useLanguage();
  const tr = (english: string) => t(language, english);
  const items = buildChecklist(instance, solution, pins, language);
  const gaps = items.some((i) => !i.ok && i.kind === "gap");
  const coverageBlocked = items.some((i) => !i.ok && (i.id === "empty" || i.id === "shift-min"));
  const supervisionBlocked = items.some((i) => i.id === "sup" && !i.ok && i.kind === "hard");
  const canPublish = !!solution && ["optimal", "feasible"].includes(solution.status) && !needsBuild && !coverageBlocked && !supervisionBlocked;

  return (
    <div className="mgr-panel">
      <div className="mgr-panel__head">
        <div>
          <p className="label">{tr("Publish")}</p>
          <h2 className="mgr-panel__title">{tr("Checklist & save")}</h2>
        </div>
        <div className="mgr-panel__actions">
          <button type="button" className="mgr-btn" disabled={!canPublish} onClick={onPrint}>
            {tr("Print")}
          </button>
          <button type="button" className="mgr-btn" disabled={!canPublish} onClick={onExportCsv}>{tr("Export CSV")}</button>
          <button
            type="button"
            className="mgr-btn mgr-btn--primary"
            disabled={busy || !canPublish}
            onClick={onPublish}
          >
            {busy ? tr("Saving…") : published ? tr("Re-publish") : tr("Publish")}
          </button>
        </div>
      </div>

      {toast ? <p className="mgr-toast">{tr(toast)}</p> : null}
      <p className="mgr-hint">{language === "ro" ? "Un interval este neacoperit numai dacă nu lucrează nimeni. Verificați necesarul de personal și detaliile competențelor în program." : "A period is uncovered only when nobody is working. Check staffing minimums and skill details in the schedule."}</p>
      {needsBuild ? <p className="mgr-hint" data-tone="alarm">{language === "ro" ? "Ciorna s-a schimbat după ultimul calcul. Recalculați programul înainte de publicare sau export." : "The draft changed after the last solve. Build the schedule again before publishing or exporting."}</p> : null}
      {coverageBlocked ? <p className="mgr-hint" data-tone="alarm">{language === "ro" ? "Unele ture nu au personalul minim. Verificați sugestiile de acoperire înainte de publicare." : "Some shifts lack the minimum staff. Review the coverage suggestions before publishing."}</p> : gaps ? (
        <p className="mgr-hint" data-tone="alarm">
          {language === "ro" ? "Există lipsuri în program. Verificați acoperirea și decideți înainte de publicare." : "Gaps remain. Review coverage and decide before publishing."}
        </p>
      ) : (
        <p className="mgr-hint">{language === "ro" ? "Nu există lipsuri de personal sau de ore contractate." : "No staffing or contracted-hour gaps in this schedule."}</p>
      )}

      {(["hard", "gap", "warning"] as const).map((kind) => <section key={kind} className="mital-review-group">
        <h3>{tr(kind === "hard" ? "Checks before publishing" : kind === "gap" ? "Staffing gaps to decide" : "Warnings to check")}</h3>
        <ul className="mgr-check">{items.filter((item) => item.kind === kind).map((item) => <li key={item.id} className="mgr-check__item" data-ok={item.ok || undefined} data-tone={!item.ok && item.id !== "pins" ? "alarm" : undefined}><span className="num">{item.ok ? "OK" : "!"}</span>{item.label}{!item.ok ? <button type="button" className="mital-text-action" onClick={() => onEdit(item.id === "min" || item.id === "shift-min" || item.id === "empty" ? "staff" : item.id === "skills" || item.id === "sup" ? "shifts" : "schedule")}>{tr("Review")}</button> : null}</li>)}</ul>
      </section>)}
    </div>
  );
}
