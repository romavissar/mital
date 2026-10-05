
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DemandEditor } from "@/components/demand/DemandEditor";
import { TradeoffDial } from "@/components/dial/TradeoffDial";
import { ShadowGutter } from "@/components/gutter/ShadowGutter";
import { ScheduleGrid } from "@/components/grid/ScheduleGrid";
import { CoverOptions } from "@/components/grid/CoverOptions";
import { HourBars } from "@/components/hours/HourBars";
import { SolveInspector } from "@/components/inspector/SolveInspector";
import { PublishChecklist } from "@/components/publish/PublishChecklist";
import { GapAdvisor } from "@/components/publish/GapAdvisor";
import { RepairPanel } from "@/components/repair/RepairPanel";
import { StaffEditor } from "@/components/staff/StaffEditor";
import { AbsenceControl } from "@/components/staff/AbsenceControl";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { ShiftEditor } from "@/components/shifts/ShiftEditor";
import { BusinessSetup } from "@/components/manager/BusinessSetup";
import { Walkthrough } from "@/components/manager/Walkthrough";
import { WeekPicker } from "@/components/manager/WeekPicker";
import { mondayOf, nextWeek, previousWeek, withoutWorkRules } from "@/lib/business";
import { rosterCsv } from "@/lib/csv";
import { emptyOpenPeriods, shiftStaffingGaps, shiftsBelowMinimum } from "@/lib/coverage";
import { LanguageProvider, errorText, t } from "@/lib/i18n";
import { defaultCurrencySettings, formatMoney, isCurrency, rateNote, validateConversion, type CurrencySettings as Settings } from "@/lib/currency";
import {
  changedAssignments,
  allowCoverShift,
  cloneInstance,
  instancesEqual,
  pinKey,
  setAbsence,
} from "@/lib/instance-utils";
import {
  fetchMargins,
  fetchPareto,
  getSaved,
  listSaved,
  putSaved,
  repairInstance,
  savedDocId,
  solveInstance,
} from "@/lib/solver-client";
import type {
  ExactMarginEntry,
  Instance,
  ManagerPanel,
  ParetoResponse,
  Pin,
  Solution,
} from "@/lib/types";

const defaultSettings = (accounting: Settings["display_currency"]) =>
  defaultCurrencySettings(accounting, navigator.language.toLowerCase().startsWith("ro") ? "ro" : "en");

const usablePins = (instance: Instance, pins: Pin[]) => pins.filter((pin) => {
  const employee = instance.employees.find((person) => person.id === pin.employee);
  const shift = instance.shifts.find((item) => item.id === pin.shift);
  if (!employee || !shift || employee.absences?.some((absence) => absence.day === pin.day)) return false;
  if (!employee.availability.some((slot) => slot.day === pin.day && slot.shifts.includes(pin.shift))) return false;
  const needed = instance.demand.filter((row) => row.day === pin.day && row.required > 0 && row.period >= shift.start_period && row.period < shift.end_period);
  return !needed.length || needed.some((row) => employee.skills.includes(row.skill));
});

export default function Home() {
  const [instanceId, setInstanceId] = useState("");
  const [baseline, setBaseline] = useState<Instance | null>(null);
  const [draft, setDraft] = useState<Instance | null>(null);
  const [solution, setSolution] = useState<Solution | null>(null);
  const [published, setPublished] = useState<Solution | null>(null);
  const [isPublished, setIsPublished] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<ManagerPanel>("schedule");

  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"load" | "solve" | "ready">("load");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [businessIds, setBusinessIds] = useState<string[]>([]);
  const [businessChoices, setBusinessChoices] = useState<{ id: string; name: string }[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [returnBusinessId, setReturnBusinessId] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<"checking" | "available" | "missing" | "damaged">("missing");
  const [businessName, setBusinessName] = useState("");
  const [localMode, setLocalMode] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [solvedInstance, setSolvedInstance] = useState<Instance | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings("EUR"));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [suggestedHireSkill, setSuggestedHireSkill] = useState<string | null>(null);
  const [dismissedAdvice, setDismissedAdvice] = useState<Set<string>>(new Set());
  const [frontier, setFrontier] = useState<ParetoResponse | null>(null);
  const [frontierIndex, setFrontierIndex] = useState<number | null>(null);
  const [frontierStatus, setFrontierStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [frontierRetry, setFrontierRetry] = useState(0);
  const onboardingActive = settings.onboarding === "active";
  const onboardingStep = settings.onboarding_step ?? 2;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const appearance = settings.appearance ?? "system";
    const apply = () => { document.documentElement.dataset.theme = appearance === "system" ? media.matches ? "dark" : "light" : appearance; };
    localStorage.setItem("mital-appearance", appearance);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.appearance]);

  const [margins, setMargins] = useState<ExactMarginEntry[]>([]);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [marginsStatus, setMarginsStatus] = useState<
    "idle" | "pending" | "ready" | "error"
  >("idle");
  const [marginsError, setMarginsError] = useState<string | null>(null);
  const [marginsTime, setMarginsTime] = useState<number | null>(null);
  const [marginsNote, setMarginsNote] = useState<string | null>(null);
  const [marginsSource, setMarginsSource] = useState<
    "exact_precomputed" | "sampled" | null
  >(null);

  const solveGen = useRef(0);
  const frontierGen = useRef(0);
  const saveGen = useRef(0);
  const persisted = useRef("");
  const persistedWorking = useRef("");
  const fingerprint = (inst: Instance, opts: Settings) => JSON.stringify({ inst, opts });

  const dirty = useMemo(
    () =>
      baseline != null && draft != null && !instancesEqual(baseline, draft),
    [baseline, draft],
  );

  useEffect(() => { setDismissedAdvice(new Set()); }, [draft, solution]);

  const flushDraft = useCallback(async () => {
    ++saveGen.current;
    if (!localMode || !draft || !window.mital) return;
    const next = fingerprint(draft, settings);
    if (next === persisted.current) return;
    setSaveState("saving");
    await window.mital.saveDraft(savedDocId(draft), businessName, draft, settings);
    persisted.current = next;
    setSaveState("saved");
  }, [localMode, draft, settings, businessName]);

  useEffect(() => {
    if (!localMode || !window.mital || !draft || !solution || !solvedInstance || saveState !== "saved" || !instancesEqual(draft, solvedInstance)) return;
    const snapshot = JSON.stringify({ instance: draft, solution });
    if (snapshot === persistedWorking.current) return;
    let active = true;
    void window.mital.saveWorking(savedDocId(draft), draft, solution).then((saved) => {
      if (active && saved) persistedWorking.current = snapshot;
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [localMode, draft, solution, solvedInstance, saveState]);

  const refreshSaved = useCallback(async () => {
    try {
      setSavedIds(await listSaved());
    } catch {
      setSavedIds([]);
    }
  }, []);

  const refreshBusinesses = useCallback(async () => {
    const ids = await window.mital?.listBusinesses() ?? [];
    setBusinessIds(ids);
    const docs = await Promise.allSettled(ids.map((id) => window.mital!.loadBusiness(id)));
    setBusinessChoices(ids.map((id, index) => ({ id, name: docs[index].status === "fulfilled" ? docs[index].value.business_name : id })));
  }, []);

  useEffect(() => {
    if (!selectedBusinessId || !window.mital) { setBackupStatus("missing"); return; }
    let active = true;
    setBackupStatus("checking");
    window.mital.backupStatus(selectedBusinessId).then((status) => { if (active) setBackupStatus(status); })
      .catch(() => { if (active) setBackupStatus("damaged"); });
    return () => { active = false; };
  }, [selectedBusinessId, saveState, isPublished]);

  const loadLocal = useCallback(async (id: string, skipFlush = false) => {
    if (!skipFlush) {
      try { await flushDraft(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    }
    const gen = ++solveGen.current;
    setSelectedBusinessId(id);
    setBusy(true);
    setError(null);
    try {
      const doc = await window.mital?.loadBusiness(id);
      if (!doc || gen !== solveGen.current) return;
      const linked = withoutWorkRules(doc.draft);
      const upgraded = !instancesEqual(linked, doc.draft);
      if (!instancesEqual(linked, doc.draft)) await window.mital!.saveDraft(id, doc.business_name, linked, doc.settings);
      setBusinessName(doc.business_name);
      setInstanceId(linked.id);
      setSettings(doc.settings);
      setBaseline(cloneInstance(doc.published?.instance ?? linked));
      setDraft(cloneInstance(linked));
      setPublished(doc.published?.solution ?? null);
      setPublishedAt(doc.published_at ?? null);
      const current = doc.published?.solution && instancesEqual(linked, doc.published.instance);
      const working = doc.working?.solution && instancesEqual(linked, doc.working.instance);
      const restored = current ? doc.published!.solution : working ? doc.working!.solution : null;
      setSolution(restored);
      setSolvedInstance(restored ? cloneInstance(linked) : null);
      setIsPublished(Boolean(current));
      setPins([]);
      setChangedKeys(new Set());
      setSelectedEmployeeId(null);
      setSuggestedHireSkill(null);
      setReturnBusinessId(null);
      setPanel(doc.settings.onboarding === "active" ? "staff" : linked.employees.length ? "schedule" : "staff");
      setLocalMode(true);
      setSaveState("saved");
      persisted.current = fingerprint(linked, doc.settings);
      persistedWorking.current = working ? JSON.stringify({ instance: linked, solution: doc.working!.solution }) : "";
      localStorage.setItem("mital-last-business", id);
      setPhase("ready");
      if (upgraded && linked.employees.length && linked.demand.length) {
        const rebuilt = await solveInstance(linked);
        if (gen === solveGen.current) {
          setSolution(rebuilt);
          setSolvedInstance(cloneInstance(linked));
          setToast(doc.settings.language === "ro" ? "Programul a fost recalculat fără vechile reguli de muncă." : "Schedule rebuilt without the old work rules.");
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (gen === solveGen.current) setBusy(false); }
  }, [flushDraft]);

  useEffect(() => {
    void (async () => {
      void refreshSaved();
      const ids = await window.mital?.listBusinesses() ?? [];
      setBusinessIds(ids);
      if (!ids.length) { setPanel("setup"); setPhase("ready"); return; }
      const docs = await Promise.allSettled(ids.map((id) => window.mital!.loadBusiness(id)));
      setBusinessChoices(ids.map((id, index) => ({ id, name: docs[index].status === "fulfilled" ? docs[index].value.business_name : id })));
      const valid = docs.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const latest = valid.sort((a, b) => b.draft.start_date.localeCompare(a.draft.start_date))[0];
      const last = valid.find((doc) => doc.business_id === localStorage.getItem("mital-last-business"));
      const working = valid.find((doc) => doc.working && instancesEqual(doc.draft, doc.working.instance));
      if (last || working || latest) await loadLocal((last ?? working ?? latest).business_id);
      else { setSelectedBusinessId(ids[0]); setError("Saved business could not be opened. Try restoring its previous save."); setPanel("setup"); setPhase("ready"); }
    })().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const reSolve = useCallback(
    async (inst: Instance, nextPins: Pin[]) => {
      if (!inst.employees.length) { setError("Add staff before building the schedule."); setPanel("staff"); return; }
      if (!inst.demand.length) { setError("Add demand before building the schedule."); setPanel("demand"); return; }
      if (inst.pay_basis === "monthly_salary" && inst.employees.some((employee) => !employee.monthly_salary || employee.monthly_salary <= 0)) {
        setError("Enter a positive monthly salary for every employee."); setPanel("staff"); return;
      }
      if (inst.pay_basis !== "monthly_salary" && inst.employees.some((employee) => employee.ot_wage < employee.wage)) {
        setError("Extra overtime cost must be at least the hourly wage for every employee."); setPanel("staff"); return;
      }
      const gen = ++solveGen.current;
      const validPins = usablePins(inst, nextPins);
      if (validPins.length !== nextPins.length) setPins(validPins);
      setBusy(true);
      setError(null);
      setPhase("solve");
      try {
        const sol = await solveInstance(inst, {
          time_limit_s: 8,
          mip_gap: 0.02,
          duals: true,
          pins: validPins,
        });
        if (gen !== solveGen.current) return;
        setSolution(sol);
        setSolvedInstance(cloneInstance(inst));
        setPhase("ready");
        if (!published) setPublished(sol);
      } catch (e) {
        if (gen === solveGen.current) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase("ready");
        }
      } finally {
        if (gen === solveGen.current) setBusy(false);
      }
    },
    [published],
  );

  // Margins when roster settles (no pins → cache may hit).
  useEffect(() => {
    if (!insightsOpen || !draft || !solution || !solvedInstance || !instancesEqual(draft, solvedInstance) || busy || phase !== "ready") return;
    const ac = new AbortController();
    setMarginsStatus("pending");
    setMarginsError(null);
    setMargins([]);
    setMarginsTime(null);
    setMarginsSource(null);

    const timer = window.setTimeout(() => fetchMargins(draft, solution, {
      top_n: 8,
      signal: ac.signal,
      pins,
    })
      .then((res) => {
        setMargins(res.margins);
        setMarginsTime(res.compute_time_s);
        setMarginsNote(res.note);
        setMarginsSource(res.source);
        setMarginsStatus("ready");
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setMarginsStatus("error");
        setMarginsError(e instanceof Error ? e.message : String(e));
      }), 350);

    return () => { window.clearTimeout(timer); ac.abort(); };
  }, [draft, solution, solvedInstance, pins, busy, phase, insightsOpen]);

  const onPin = useCallback(
    (
      pin: Pin | null,
      target: { employee: string; day: number; shift: string },
    ) => {
      if (!draft) return;
      const key = `${target.employee}|${target.day}|${target.shift}`;
      let next: Pin[];
      if (pin == null) {
        next = pins.filter((p) => pinKey(p) !== key);
      } else {
        next = [...pins.filter((p) => pinKey(p) !== key), pin];
      }
      setPins(next);
      void reSolve(draft, next);
    },
    [draft, pins, reSolve],
  );

  const hasSolution = !!solution;
  const solving = phase === "solve";
  useEffect(() => {
    const gen = ++frontierGen.current;
    setFrontier(null);
    setFrontierIndex(null);
    if (!draft || !solvedInstance || !instancesEqual(draft, solvedInstance) || !hasSolution || pins.length || solving) {
      setFrontierStatus("idle");
      return;
    }
    setFrontierStatus("loading");
    void fetchPareto(draft, { pareto_points: 10, time_limit_s: 4 }).then((result) => {
      if (gen !== frontierGen.current) return;
      setFrontier(result);
      setFrontierStatus("ready");
    }).catch(() => { if (gen === frontierGen.current) setFrontierStatus("error"); });
    return () => { if (gen === frontierGen.current) ++frontierGen.current; };
  }, [draft, solvedInstance, hasSolution, pins, solving, frontierRetry]);

  const chooseFrontierPoint = useCallback((index: number) => {
    if (!frontier || index === frontierIndex) return;
    const point = frontier.frontier[index];
    if (!point) return;
    setFrontierIndex(index);
    setSolution(point.solution);
    setChangedKeys(new Set());
    setIsPublished(false);
  }, [frontier, frontierIndex]);

  const onStaffApply = useCallback(() => {
    if (!draft) return;
    const ids = new Set(draft.employees.map((e) => e.id));
    const nextPins = pins.filter((p) => ids.has(p.employee));
    setPins(nextPins);
    setChangedKeys(new Set());
    if (!draft.demand.length) { setError(null); setPanel("demand"); return; }
    setPanel("schedule");
    void reSolve(draft, nextPins);
  }, [draft, pins, reSolve]);

  const applyGapSuggestion = (next: Instance, result: Solution) => {
    ++solveGen.current;
    setDraft(next);
    setSolution(result);
    setSolvedInstance(cloneInstance(next));
    setChangedKeys(solution ? changedAssignments(solution, result) : new Set());
    setIsPublished(false);
    setError(null);
    setPanel("schedule");
    setToast("Suggestion implemented in the draft schedule");
  };

  const onDemandApply = useCallback(() => {
    if (!draft) return;
    setChangedKeys(new Set());
    setPanel("schedule");
    void reSolve(draft, pins);
  }, [draft, pins, reSolve]);

  const onShiftsApply = useCallback((next: Instance) => {
    const changed = !draft || !instancesEqual(draft, next);
    setDraft(next);
    if (changed) {
      setSolution(null);
      setSolvedInstance(null);
      setIsPublished(false);
      setPins([]);
      setToast("Check staff availability after changing shifts.");
    }
    setPanel("shifts");
  }, [draft]);

  const onRepair = useCallback(
    async (nextInstance: Instance) => {
      const baselineSol = solution ?? published;
      if (!baselineSol) {
        setError("Solve or publish a roster before repair.");
        return;
      }
      const gen = ++solveGen.current;
      setBusy(true);
      setError(null);
      setPhase("solve");
      try {
        const before = solution ?? baselineSol;
        let sol = await repairInstance(nextInstance, baselineSol, {
          time_limit_s: 8,
          mip_gap: 0.02,
        });
        if (emptyOpenPeriods(nextInstance, sol).size || shiftsBelowMinimum(nextInstance, sol)) {
          try {
            const rebuilt = await solveInstance(nextInstance, { time_limit_s: 8, mip_gap: 0.02 });
            const rank = (result: Solution) => [emptyOpenPeriods(nextInstance, result).size,
              shiftStaffingGaps(nextInstance, result).reduce((sum, gap) => sum + gap.missing, 0), result.shortfall_person_periods];
            const oldRank = rank(sol), newRank = rank(rebuilt);
            if (["optimal", "feasible"].includes(rebuilt.status) && newRank.some((value, i) => value < oldRank[i] && newRank.slice(0, i).every((earlier, j) => earlier === oldRank[j]))) sol = rebuilt;
          } catch { /* Keep the valid repair if a second search fails. */ }
        }
        if (gen !== solveGen.current) return;
        setDraft(nextInstance);
        setPins([]);
        setChangedKeys(changedAssignments(before, sol));
        setSolution(sol);
        setSolvedInstance(cloneInstance(nextInstance));
        setIsPublished(false);
        setPhase("ready");
        setPanel("schedule");
        const empty = emptyOpenPeriods(nextInstance, sol).size;
        setToast(empty ? settings.language === "ro" ? `Absența a fost înregistrată. ${empty} intervale rămân fără personal; verificați opțiunile de acoperire.` : `Absence saved. ${empty} periods still have nobody scheduled; review cover options.` : "Repaired");
      } catch (e) {
        if (gen === solveGen.current) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase("ready");
        }
      } finally {
        if (gen === solveGen.current) setBusy(false);
      }
    },
    [published, solution, settings.language],
  );

  const onAbsence = useCallback((employeeId: string, day: number, reason: "sick" | "out" | null) => {
    if (!draft) return;
    const next = setAbsence(draft, employeeId, day, reason);
    if (solution || published) void onRepair(next);
    else {
      setDraft(next);
      setPins([]);
      if (next.demand.length) void reSolve(next, []);
    }
  }, [draft, solution, published, onRepair, reSolve]);

  const onConfirmCover = useCallback((employeeId: string, day: number, shiftId: string) => {
    if (!draft || busy) return;
    void onRepair(allowCoverShift(draft, employeeId, day, shiftId));
  }, [draft, busy, onRepair]);

  const onPublish = useCallback(async () => {
    if (!draft || !solution) return;
    if (solution.status !== "optimal" && solution.status !== "feasible") {
      setError("Only a feasible schedule can be published.");
      return;
    }
    if (!solvedInstance || !instancesEqual(draft, solvedInstance)) {
      setError("Build the schedule again after editing before publishing.");
      return;
    }
    if (emptyOpenPeriods(draft, solution).size || shiftsBelowMinimum(draft, solution)) {
      setError(settings.language === "ro" ? "Acoperiți toate turele până la minimul de personal înainte de publicare." : "Cover every shift to its staffing minimum before publishing.");
      return;
    }
    if (draft.rules.supervision_required !== false && draft.rules.max_people_per_shift !== 1 && solution.objective.supervisor_gap > 0) {
      setError(settings.language === "ro" ? "Supravegherea este obligatorie. Acoperiți intervalele fără responsabil înainte de publicare." : "Supervision is required. Cover shifts without a supervisor before publishing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = savedDocId(draft);
      await flushDraft();
      await window.mital!.saveDraft(id, businessName || draft.id, draft, settings);
      await putSaved(id, { instance: draft, solution });
      setSelectedBusinessId(id);
      setSolvedInstance(cloneInstance(draft));
      setPublished(solution);
      setIsPublished(true);
      setPublishedAt(new Date().toISOString());
      setBaseline(cloneInstance(draft));
      setToast("Published");
      await refreshSaved();
      await refreshBusinesses();
      setLocalMode(true);
      persisted.current = fingerprint(draft, settings);
      setSaveState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, solution, solvedInstance, refreshSaved, refreshBusinesses, settings, businessName, flushDraft]);

  const onCreateBusiness = useCallback(async (name: string, inst: Instance, language: "ro" | "en") => {
    const opts: Settings = { ...defaultCurrencySettings(inst.currency as Settings["display_currency"], language), onboarding: "active", onboarding_step: 2 };
    const id = savedDocId(inst);
    await window.mital!.saveDraft(id, name, inst, opts);
    setBusinessName(name);
    setInstanceId(inst.id);
    setSelectedBusinessId(id);
    setSettings(opts);
    setBaseline(cloneInstance(inst));
    setDraft(cloneInstance(inst));
    setSolution(null);
    setError(null);
    setPins([]);
    setSelectedEmployeeId(null);
    setSuggestedHireSkill(null);
    setToast(null);
    setSolvedInstance(null);
    setPublished(null);
    setPublishedAt(null);
    setIsPublished(false);
    setLocalMode(true);
    setSaveState("saved");
    persisted.current = fingerprint(inst, opts);
    setPanel("staff");
    setPhase("ready");
    await refreshBusinesses();
  }, [refreshBusinesses]);

  const onWeekChange = useCallback(async (value: string) => {
    if (!draft || !value || !window.mital) return;
    await flushDraft();
    const week = mondayOf(value);
    const id = `${draft.id}-${week}`;
    if (businessIds.includes(id)) { await loadLocal(id); return; }
    const next = withoutWorkRules({ ...cloneInstance(draft), start_date: week, demand: [],
      employees: draft.employees.map((employee) => ({ ...employee, absences: [] })) });
    await window.mital.saveDraft(id, businessName, next, settings);
    setSelectedBusinessId(id);
    setDraft(next);
    setBaseline(cloneInstance(next));
    setSolution(null);
    setError(null);
    setToast(null);
    setSolvedInstance(null);
    setPublished(null);
    setPublishedAt(null);
    setIsPublished(false);
    setPins([]);
    setSelectedEmployeeId(null);
    setLocalMode(true);
    setSaveState("saved");
    persisted.current = fingerprint(next, settings);
    setPanel("demand");
    await refreshBusinesses();
  }, [draft, businessIds, businessName, settings, loadLocal, refreshBusinesses, flushDraft]);

  const onCopyForward = useCallback(async () => {
    if (!draft || !window.mital) return;
    try {
      await flushDraft();
      const candidates = [...new Set([...businessIds, ...savedIds])].filter((id) => id.startsWith(`${draft.id}-`) && id.slice(draft.id.length + 1) < draft.start_date).sort();
      const source = candidates.at(-1);
      if (!source) { setError("No earlier saved week is available to copy."); return; }
      const previous = businessIds.includes(source) ? (await window.mital.loadBusiness(source)).draft : (await getSaved(source)).instance;
      const next = withoutWorkRules({ ...cloneInstance(previous), start_date: draft.start_date,
        employees: previous.employees.map((employee) => ({ ...employee, absences: [] })),
        rules: { ...previous.rules, min_people_per_shift: draft.rules.min_people_per_shift,
          max_people_per_shift: draft.rules.max_people_per_shift, supervision_required: draft.rules.supervision_required } });
      await window.mital.saveDraft(savedDocId(next), businessName, next, settings);
      setDraft(next);
      setSolution(null);
      setSolvedInstance(null);
      setPins([]);
      setIsPublished(false);
      setSaveState("saved");
      setError(null);
      persisted.current = fingerprint(next, settings);
      setToast(settings.language === "ro" ? "Personalul și necesarul au fost copiate din săptămâna salvată anterior. Recalculați programul." : "Copied staff and demand from the previous saved week. Build the schedule before publishing.");
      setPanel("schedule");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [draft, businessIds, savedIds, businessName, settings, flushDraft]);

  useEffect(() => {
    if (!localMode || !draft || !window.mital) return;
    const gen = ++saveGen.current;
    const next = fingerprint(draft, settings);
    if (next === persisted.current) return;
    setSaveState("unsaved");
    const timer = window.setTimeout(async () => {
      if (gen !== saveGen.current) return;
      setSaveState("saving");
      try {
        await window.mital!.saveDraft(savedDocId(draft), businessName, draft, settings);
        persisted.current = next;
        if (gen === saveGen.current) setSaveState("saved");
      } catch (cause) {
        if (gen === saveGen.current) {
          setSaveState("error");
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [localMode, draft, settings, businessName]);

  const onSaveSettings = useCallback(async (next: Settings, payDraft: Instance) => {
    if (!draft || !isCurrency(draft.currency) || !window.mital) return;
    validateConversion(draft.currency, next);
    await flushDraft();
    const nextDraft = cloneInstance(payDraft);
    if (!draft.pay_basis && nextDraft.pay_basis === "hourly") delete nextDraft.pay_basis;
    const payChanged = !instancesEqual(draft, nextDraft);
    const id = savedDocId(draft);
    let existing = null;
    try { existing = await window.mital.loadBusiness(id); } catch { /* New local business document. */ }
    const savedDraft = payChanged ? nextDraft : existing?.draft ?? draft;
    await window.mital.saveBusiness(existing
      ? { ...existing, settings: next, draft: savedDraft, working: payChanged ? null : existing.working }
      : { schema_version: 1, business_id: id, business_name: draft.id, settings: next, draft: nextDraft, published: null });
    setSettings(next);
    persisted.current = fingerprint(savedDraft, next);
    setSaveState("saved");
    setToast("Settings saved");
    if (payChanged) {
      setDraft(nextDraft);
      setIsPublished(false);
      await reSolve(nextDraft, pins);
    }
  }, [draft, pins, reSolve, flushDraft]);

  const onExportBackup = useCallback(async (id: string) => {
    try {
      await flushDraft();
      const file = await window.mital?.exportBackup(id);
      if (file) setToast("Backup exported");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [flushDraft]);

  const onImportBackup = useCallback(async () => {
    try {
      await flushDraft();
      const id = await window.mital?.importBackup();
      if (!id) return;
      await refreshSaved();
      await refreshBusinesses();
      await loadLocal(id);
      setToast("Backup imported");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadLocal, refreshSaved, refreshBusinesses, flushDraft]);

  const onOpenDataFolder = useCallback(async () => {
    try {
      await window.mital?.openDataFolder();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onRecoverBusiness = useCallback(async (id: string) => {
    if (backupStatus !== "available") return;
    if (!window.confirm(settings.language === "ro" ? "Restaurați salvarea locală anterioară? Versiunea curentă va fi înlocuită." : "Restore the previous local save? The current version will be replaced.")) return;
    try {
      ++saveGen.current;
      await window.mital?.recoverBusiness(id);
      await loadLocal(id, true);
      setToast("Previous save restored");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadLocal, settings.language, backupStatus]);

  const onPrint = useCallback(() => {
    if (!draft || !solution || !solvedInstance || !instancesEqual(draft, solvedInstance)) return;
    if (!window.mital) {
      setError("Open the desktop app to print a schedule.");
      return;
    }
    void window.mital.printRoster({ instance: draft, solution, settings, business_name: businessName }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [draft, solution, settings, solvedInstance, businessName]);

  const onExportCsv = useCallback(async () => {
    if (!draft || !solution || !window.mital || !solvedInstance || !instancesEqual(draft, solvedInstance)) return;
    try {
      const file = await window.mital.exportCsv(savedDocId(draft), rosterCsv(draft, solution, settings, businessName));
      if (file) setToast("CSV exported");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [draft, solution, settings, solvedInstance, businessName]);

  const bindingCount = useMemo(
    () => margins.filter((m) => m.binding).length,
    [margins],
  );

  const setOnboarding = (step: number, state: "active" | "later" | "done" = "active") => {
    setSettings((old) => ({ ...old, onboarding: state, onboarding_step: step }));
    if (state !== "active") setPanel(step === 2 ? "staff" : step === 3 ? "shifts" : "schedule");
  };
  const peopleReady = !!draft?.employees.length && draft.employees.some((employee) => employee.skills.includes(draft.supervisor_skill)) &&
    draft.employees.every((employee) => (draft.pay_basis !== "monthly_salary" || !!employee.monthly_salary) && employee.availability.some((row) => row.shifts.length));
  const operationsReady = !!draft?.shifts.length && !!draft.demand.length && peopleReady;
  const firstScheduleReady = !!solution && ["optimal", "feasible"].includes(solution.status) && !!solvedInstance && !!draft && instancesEqual(draft, solvedInstance);
  const scheduleCurrent = !!draft && !!solution && !!solvedInstance && instancesEqual(draft, solvedInstance);

  const status =
    (error ? errorText(settings.language, error) : null) ??
    (phase === "load"
      ? `${settings.language === "ro" ? "Se încarcă" : "Loading"} ${instanceId}…`
      : phase === "solve" || busy
        ? `${settings.language === "ro" ? "Se calculează" : "Solving"} ${instanceId}…`
        : solution
          ? `${t(settings.language, solution.status)} · ${t(settings.language, "Estimated pay")} ${draft && isCurrency(draft.currency) ? formatMoney(solution.objective.wages + solution.objective.overtime, draft.currency, settings) : ""} · z ${solution.fairness.max_deviation_hours.toFixed(1)} h${pins.length ? ` · ${pins.length} ${settings.language === "ro" ? "ture fixate" : `pin${pins.length === 1 ? "" : "s"}`}` : ""}${dirty ? settings.language === "ro" ? " · modificat" : " · edited" : ""}${isPublished ? settings.language === "ro" ? " · publicat" : " · published" : ""}`
          : "");

  const tabs: { id: ManagerPanel; label: string }[] = [
    { id: "schedule", label: "Schedule" },
    { id: "staff", label: "People" },
    { id: "shifts", label: "Operations" },
    { id: "publish", label: "Review & publish" },
  ];
  const tr = (english: string) => t(settings.language, english);
  const pageTitle = panel === "staff" ? "People" : panel === "shifts" || panel === "demand" ? "Operations" : panel === "publish" ? "Review & publish" : panel === "settings" ? "Settings" : panel === "repair" ? "Repair" : "Schedule";
  const publishedLabel = `${tr("Published")}${publishedAt ? ` · ${new Intl.DateTimeFormat(settings.language === "ro" ? "ro-RO" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(publishedAt))}` : ""}`;
  const beginNewBusiness = () => void flushDraft().then(() => { setReturnBusinessId(selectedBusinessId); setDraft(null); setSolution(null); setBusinessName(""); setInstanceId(""); setSelectedBusinessId(""); setPanel("setup"); }).catch((cause) => setError(String(cause)));
  const exitSetup = () => {
    if (returnBusinessId) { void loadLocal(returnBusinessId); return; }
    if (draft) { setOnboarding(onboardingStep, "later"); return; }
    setPanel("welcome");
  };

  return (
    <LanguageProvider language={settings.language}>
    <div className="mital-app" data-setup={!draft || onboardingActive || undefined}>
      <aside className="mital-rail">
        <div className="mital-wordmark"><img src="./brand/mital-mark.png" alt="" /><span>mital</span></div>
        {draft && !onboardingActive ? <>
          <label className="mgr-field mital-switcher"><span className="label">{tr("Saved weeks")}</span>
            <select value={selectedBusinessId} onChange={(event) => { if (event.target.value) void loadLocal(event.target.value); }}>
              {businessChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id.slice(-10)}</option>)}
            </select>
          </label>
          <button type="button" className="mital-rail__quiet" onClick={beginNewBusiness}>{tr("New business")}</button>
          <nav className="mital-nav" aria-label={tr("Navigation")}>
            {tabs.map((item) => <button key={item.id} type="button" data-active={panel === item.id || (item.id === "schedule" && panel === "repair") || (item.id === "shifts" && panel === "demand") || undefined} onClick={() => setPanel(item.id)}>{tr(item.label)}</button>)}
          </nav>
        </> : null}
        {draft && !onboardingActive ? <button type="button" className="mital-rail__settings" data-active={panel === "settings" || undefined} onClick={() => setPanel("settings")}>{tr("Settings")}</button> : null}
      </aside>
      <main className="mital-shell">
      {!onboardingActive && draft ? <header className="mital-topbar">
        <div className="mital-topbar__title"><p className="label">{businessName}</p><h1>{tr(pageTitle)}</h1></div>
        <div className="mital-topbar__week">
          <button type="button" className="mgr-btn" aria-label={tr("Previous week")} onClick={() => void onWeekChange(previousWeek(draft.start_date))}>←</button>
          <WeekPicker value={draft.start_date} onChange={(value) => void onWeekChange(value).catch((cause) => setError(String(cause)))} />
          <button type="button" className="mgr-btn" aria-label={tr("Next week")} onClick={() => void onWeekChange(nextWeek(draft.start_date))}>→</button>
          <button type="button" className="mital-text-action" onClick={() => void onCopyForward()}>{tr("Copy previous week")}</button>
        </div>
        <div className="mital-topbar__actions"><span className="mgr-hint" role="status">{isPublished ? publishedLabel : `${tr("Draft")} · ${tr(saveState)}`}</span>
          {panel === "schedule" && draft.employees.length && draft.demand.length ? <button type="button" className="mgr-btn mgr-btn--primary" disabled={busy} onClick={() => void reSolve(draft, pins)}>{solution ? tr("Rebuild") : tr("Build schedule")}</button> : null}
        </div>
      </header> : null}
      {settings.onboarding === "later" && draft ? <div className="mital-resume">{tr("Setup is unfinished.")} <button type="button" className="mital-text-action" onClick={() => setOnboarding(settings.onboarding_step ?? 2)}>{tr("Resume setup")}</button></div> : null}
      {draft && isCurrency(draft.currency) && rateNote(draft.currency, settings) ? <p className="mgr-hint">{rateNote(draft.currency, settings)}</p> : null}
      {error && draft ? <p className="mgr-hint" data-tone="alarm" role="alert">{errorText(settings.language, error)}</p> : null}

      {(!draft && panel === "setup") || onboardingActive ? <Walkthrough
        step={draft ? onboardingStep : 1}
        onBack={draft && onboardingStep > 1 ? () => setOnboarding(onboardingStep - 1) : undefined}
        onNext={draft ? () => { if (onboardingStep === 4) setReturnBusinessId(null); setOnboarding(onboardingStep === 4 ? 4 : onboardingStep + 1, onboardingStep === 4 ? "done" : "active"); } : undefined}
        onLater={draft ? () => { setReturnBusinessId(null); setOnboarding(onboardingStep, "later"); } : undefined}
        onExit={exitSetup}
        canNext={onboardingStep === 1 || onboardingStep === 2 && peopleReady || onboardingStep === 3 && operationsReady || onboardingStep === 4 && firstScheduleReady}
      >
        {!draft ? <BusinessSetup onCreate={onCreateBusiness} /> : onboardingStep === 1 ? <section className="mgr-panel"><h2 className="mgr-panel__title">{businessName}</h2><p>{draft.start_date} · {draft.currency} · {tr(draft.pay_basis === "monthly_salary" ? "Monthly salaries" : "Hourly wages")}</p><p className="mgr-hint">{tr("You can adjust pay and language later in Settings.")}</p></section>
          : onboardingStep === 2 ? <><StaffEditor instance={draft} onChange={setDraft} onApply={() => {}} hideApply settings={settings} /><p className="mgr-hint">{peopleReady ? tr("People ready.") : tr("Add a supervisor, pay, and availability to continue.")}</p></>
          : onboardingStep === 3 ? <div className="mital-sections"><ShiftEditor instance={draft} onApply={onShiftsApply} /><DemandEditor instance={draft} onChange={setDraft} onApply={() => {}} hideApply /><p className="mgr-hint">{operationsReady ? tr("Operations ready.") : tr("Add demand and confirm staff availability to continue.")}</p></div>
          : <section className="mgr-panel"><h2 className="mgr-panel__title">{tr("Build your first schedule")}</h2><p className="mgr-hint">{draft.employees.length} {tr("Staff").toLowerCase()} · {draft.shifts.length} {tr("Shifts").toLowerCase()} · {draft.demand.length} {tr("Demand").toLowerCase()}</p><button type="button" className="mgr-btn mgr-btn--primary" disabled={busy} onClick={() => void reSolve(draft, pins)}>{busy ? tr("Solving…") : tr("Build schedule")}</button>{solution ? <p role="status">{tr("Status")}: {tr(solution.status)}{emptyOpenPeriods(draft, solution).size > 0 ? ` · ${emptyOpenPeriods(draft, solution).size} ${tr("uncovered periods")}` : ""}</p> : null}</section>}
      </Walkthrough> : <>

      {!draft && panel === "welcome" ? <section className="mital-welcome mgr-panel"><p className="label">mital</p><h1>{tr("Your schedules, on this computer.")}</h1><p className="mgr-hint">{tr("Start a business or restore a local backup to continue.")}</p><div className="mgr-panel__actions"><button type="button" className="mgr-btn mgr-btn--primary" onClick={() => setPanel("setup")}>{tr("New business")}</button><button type="button" className="mgr-btn" onClick={() => void onImportBackup()}>{tr("Import backup")}</button></div></section> : null}

      {toast && panel === "schedule" ? (
        <p className="mgr-toast">{tr(toast)}</p>
      ) : null}

      {draft && panel === "schedule" ? <section className="mital-fairness" aria-label={tr("Cost and fairness")}>
        <div className="mital-fairness__intro"><div><p className="label">{tr("Schedule options")}</p><h2>{tr("Cost and fairness")}</h2><p className="mgr-hint">{tr("Compare schedules with the same shift coverage. Choose one to preview before publishing.")}</p></div>
          {frontierStatus === "loading" ? <span className="mgr-hint" role="status">{tr("Calculating options locally…")}</span> : null}</div>
        {!scheduleCurrent ? <p className="mgr-hint">{tr("Build the schedule to compare cost and fairness.")}</p>
          : pins.length ? <p className="mgr-hint">{tr("Clear pinned shifts to compare schedule options.")}</p>
          : frontierStatus === "ready" && frontier && isCurrency(draft.currency) ? <><TradeoffDial frontier={frontier.frontier} index={frontierIndex} onChange={chooseFrontierPoint} accounting={draft.currency} settings={settings} source={frontier.source} />
              {frontierIndex !== null ? <p className="mgr-hint">{tr("Selected variant is a draft until published.")}</p> : null}</>
          : frontierStatus === "error" ? <div className="mgr-panel__actions"><p className="mgr-hint">{tr("Options could not be calculated.")}</p><button type="button" className="mgr-btn" onClick={() => setFrontierRetry((value) => value + 1)}>{tr("Try again")}</button></div>
          : null}
      </section> : null}

      {draft && solution && scheduleCurrent && panel === "schedule" ? (
        <>
          <div className="mital-exceptions">
            {emptyOpenPeriods(draft, solution).size > 0 ? <button type="button" data-alert onClick={() => setPanel("publish")}>{emptyOpenPeriods(draft, solution).size} {tr("uncovered periods")}</button> : null}
            {solution.objective.supervisor_gap > 0 ? <button type="button" data-alert onClick={() => setPanel("publish")}>{solution.objective.supervisor_gap} {tr("supervisor gaps")}</button> : null}
            <label className="mgr-field mital-inspect-select"><span className="label">{tr("Inspect person")}</span><select value={selectedEmployeeId ?? ""} onChange={(event) => setSelectedEmployeeId(event.target.value || null)}><option value="">{tr("Select person…")}</option>{draft.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
          </div>
          {emptyOpenPeriods(draft, solution).size > 0 ? <div className="mgr-toast" role="status" data-tone="alarm">
            {settings.language === "ro" ? "Unele ture nu pot fi acoperite cu disponibilitatea, competențele și limitele de ore introduse." : "Some shifts cannot be covered with the entered availability, skills, and hour limits."}
            <button type="button" className="mital-text-action" onClick={() => setPanel("publish")}>{settings.language === "ro" ? "Vezi opțiunile" : "Review cover options"}</button>
          </div> : null}
          <CoverOptions instance={draft} solution={solution} busy={busy} onConfirm={onConfirmCover} />
          <div className="mital-schedule-layout"><div className="mital-schedule-grid">
            <ScheduleGrid
              instance={draft}
              solution={solution}
              pins={pins}
              changedKeys={changedKeys}
              pinEnabled
              onPin={onPin}
              onSelectEmployee={setSelectedEmployeeId}
            />
          </div>{draft.employees.find((employee) => employee.id === selectedEmployeeId) ? <aside className="mital-employee-inspector">
            <button type="button" className="mital-text-action" onClick={() => setSelectedEmployeeId(null)}>{tr("Close")}</button>
            <h2>{draft.employees.find((employee) => employee.id === selectedEmployeeId)?.name}</h2>
            <p>{tr("Hours")}: <span className="num">{solution.per_employee.find((item) => item.employee === selectedEmployeeId)?.hours ?? 0}</span></p>
            <p>{tr("Available days")}: <span className="num">{draft.employees.find((employee) => employee.id === selectedEmployeeId)?.availability.filter((day) => day.shifts.length).length ?? 0}</span></p>
            <p className="label">{tr("Assigned shifts")}</p>
            <ul>{solution.assignments.filter((item) => item.employee === selectedEmployeeId).map((item) => <li key={`${item.day}-${item.shift}`}>{tr("Day")} {item.day + 1} · {draft.shifts.find((shift) => shift.id === item.shift)?.label ?? item.shift}</li>)}</ul>
            {selectedEmployeeId ? <AbsenceControl key={selectedEmployeeId} instance={draft} employeeId={selectedEmployeeId} busy={busy} onChange={onAbsence} /> : null}
            <button type="button" className="mgr-btn" onClick={() => setPanel("staff")}>{tr("Edit person")}</button>
          </aside> : null}</div>
          <details className="mital-insights" open={insightsOpen} onToggle={(event) => setInsightsOpen(event.currentTarget.open)}><summary>{tr("Insights")} <span className="mgr-hint">{tr("Estimated pay")} {isCurrency(draft.currency) ? formatMoney(solution.objective.wages + solution.objective.overtime, draft.currency, settings) : ""}</span></summary>
            <div className="mital-shell__body">
              <SolveInspector solution={solution} payBasis={draft.pay_basis} accounting={draft.currency as Settings["display_currency"]} settings={settings} bindingCount={marginsStatus === "ready" ? bindingCount : null} />
              <HourBars instance={draft} solution={solution} />
              <ShadowGutter margins={margins} status={marginsStatus} error={marginsError} computeTimeS={marginsTime} note={marginsNote} source={marginsSource} />
            </div>
          </details>
        </>
      ) : null}

      {draft && !scheduleCurrent && panel === "schedule" ? <section className="mgr-panel">
        <h2 className="mgr-panel__title">{tr("Build this week’s schedule")}</h2>
        <p className="mgr-hint">{solution ? tr("The draft changed since the last build. Rebuild to review the current schedule.") : tr("Add staff and demand, then build a schedule. Draft changes are saved locally before publishing.")}</p>
        <div className="mgr-panel__actions"><button type="button" className="mgr-btn" onClick={() => setPanel("staff")}>{tr("People")}</button><button type="button" className="mgr-btn" onClick={() => setPanel("shifts")}>{tr("Operations")}</button></div>
      </section> : null}

      {draft && panel === "staff" ? (
        <StaffEditor
          key={savedDocId(draft)}
          instance={draft}
          onChange={setDraft}
          onApply={onStaffApply}
          busy={busy}
          settings={settings}
          initialSelected={selectedEmployeeId}
          suggestedSkill={suggestedHireSkill}
          onDismissSuggestedSkill={() => setSuggestedHireSkill(null)}
          onAbsence={onAbsence}
        />
      ) : null}

      {draft && (panel === "shifts" || panel === "demand") ? <div className="mital-sections">
        <ShiftEditor key={savedDocId(draft)} instance={draft} onApply={onShiftsApply} />
        <DemandEditor key={savedDocId(draft)} instance={draft} onChange={setDraft} onApply={onDemandApply} busy={busy} />
      </div> : null}

      {draft && panel === "repair" ? (
        <RepairPanel
          key={savedDocId(draft)}
          instance={draft}
          published={published ?? solution}
          busy={busy}
          onRepair={(next) => void onRepair(next)}
        />
      ) : null}

      {draft && panel === "publish" ? (
        <>{solution && solvedInstance && instancesEqual(draft, solvedInstance) && (solution.uncovered_entry_count > 0 || solution.objective.supervisor_gap > 0 || shiftsBelowMinimum(draft, solution) > 0 || solution.per_employee.some((row) => row.hours + 1e-6 < (draft.employees.find((e) => e.id === row.employee)?.min_hours ?? 0))) ? <GapAdvisor
          instance={draft} solution={solution} pins={pins} dismissed={dismissedAdvice}
          onReject={(id) => setDismissedAdvice((prev) => new Set(prev).add(id))}
          onApply={applyGapSuggestion}
          onHire={(skill) => { setDismissedAdvice((prev) => new Set(prev).add(`hire:${skill}`)); setSuggestedHireSkill(skill); setPanel("staff"); }}
          onReviewPerson={(id) => { setDismissedAdvice((prev) => new Set(prev).add(`minimum:${id}`)); setSuggestedHireSkill(null); setSelectedEmployeeId(id); setPanel("staff"); }}
        /> : null}<PublishChecklist
          instance={draft}
          solution={solution}
          pins={pins}
          published={isPublished}
          toast={toast}
          busy={busy}
          onPublish={() => void onPublish()}
          onPrint={onPrint}
          onExportCsv={() => void onExportCsv()}
          onEdit={setPanel}
          needsBuild={!solvedInstance || !instancesEqual(draft, solvedInstance)}
        /></>
      ) : null}

      {draft && isCurrency(draft.currency) && panel === "settings" ? (
        <SettingsPanel key={savedDocId(draft)} accounting={draft.currency} instance={draft} settings={settings} onSave={onSaveSettings} feedback={toast}
          currentSavedId={businessIds.includes(savedDocId(draft)) ? savedDocId(draft) : null} backupStatus={backupStatus}
          onExportBackup={(id) => void onExportBackup(id)} onImportBackup={() => void onImportBackup()}
          onOpenDataFolder={() => void onOpenDataFolder()} onRecoverBusiness={(id) => void onRecoverBusiness(id)}
          onResumeSetup={() => setOnboarding(2)} />
      ) : null}
      </>}

      {!draft && !error ? (
        <div className="mital-shell__status">{status}</div>
      ) : null}
      {error && !draft ? (
        <div className="mital-shell__status" data-tone="alarm">
          {error}
          {selectedBusinessId ? <div className="mgr-panel__actions">
            <button type="button" className="mgr-btn" disabled={backupStatus !== "available"} onClick={() => void onRecoverBusiness(selectedBusinessId)}>{tr("Restore previous save")}</button>
            <button type="button" className="mgr-btn" onClick={() => void onImportBackup()}>{tr("Import backup")}</button>
          </div> : null}
        </div>
      ) : null}
      </main>
    </div>
    </LanguageProvider>
  );
}
