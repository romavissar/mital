
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cssPx, cssVar } from "@/lib/css-var";
import { emptyOpenPeriods } from "@/lib/coverage";
import { assignmentKey, pinKey } from "@/lib/instance-utils";
import { t, useLanguage } from "@/lib/i18n";
import type { Instance, Pin, Solution, Shift } from "@/lib/types";

type Props = {
  instance: Instance;
  solution: Solution;
  pins?: Pin[];
  changedKeys?: Set<string>;
  onPin?: (pin: Pin | null, target: { employee: string; day: number; shift: string }) => void;
  onSelectEmployee?: (id: string) => void;
  pinEnabled?: boolean;
};

type Tokens = {
  ink: string;
  inkSoft: string;
  paper: string;
  paperSunk: string;
  rule: string;
  ruleHour: string;
  dawn: string;
  day: string;
  dusk: string;
  alarm: string;
  dawnFill: string;
  dayFill: string;
  duskFill: string;
  alarmFill: string;
  cellW: number;
  rowH: number;
  nameColW: number;
  fontData: string;
  fontDisplay: string;
};

function readTokens(el: Element): Tokens {
  return {
    ink: cssVar("--ink", el),
    inkSoft: cssVar("--ink-soft", el),
    paper: cssVar("--paper", el),
    paperSunk: cssVar("--paper-sunk", el),
    rule: cssVar("--rule", el),
    ruleHour: cssVar("--rule-hour", el),
    dawn: cssVar("--dawn", el),
    day: cssVar("--day", el),
    dusk: cssVar("--dusk", el),
    alarm: cssVar("--alarm", el),
    dawnFill: cssVar("--dawn-fill", el),
    dayFill: cssVar("--day-fill", el),
    duskFill: cssVar("--dusk-fill", el),
    alarmFill: cssVar("--alarm-fill", el),
    cellW: cssPx("--cell-w", el),
    rowH: cssPx("--row-h", el),
    nameColW: cssPx("--namecol-w", el),
    fontData: cssVar("--font-data", el),
    fontDisplay: cssVar("--font-display", el),
  };
}

function shiftBand(shift: Shift): "dawn" | "day" | "dusk" {
  if (shift.closing) return "dusk";
  if (shift.start_period < 40) return "dawn";
  return "day";
}

function periodLabel(p: number): string {
  const h = Math.floor(p / 4);
  return `${String(h).padStart(2, "0")}:00`;
}

function sizeCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(cssW));
  const h = Math.max(1, Math.floor(cssH));
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function shiftAtPeriod(shifts: Shift[], period: number): Shift | null {
  for (const s of shifts) {
    if (period >= s.start_period && period < s.end_period) return s;
  }
  // nearest by start if between bands
  let best: Shift | null = null;
  let bestDist = Infinity;
  for (const s of shifts) {
    const mid = (s.start_period + s.end_period) / 2;
    const d = Math.abs(mid - period);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

export function ScheduleGrid({
  instance,
  solution,
  pins = [],
  changedKeys,
  onPin,
  onSelectEmployee,
  pinEnabled = false,
}: Props) {
  const language = useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLCanvasElement>(null);
  const namesRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);

  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [view, setView] = useState({ top: 0, left: 0, w: 0, h: 0 });

  const shiftById = useMemo(() => {
    const m = new Map<string, Shift>();
    for (const s of instance.shifts) m.set(s.id, s);
    return m;
  }, [instance.shifts]);

  const hoursByEmp = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of solution.per_employee) m.set(p.employee, p.hours);
    return m;
  }, [solution.per_employee]);

  const assignKeys = useMemo(() => {
    const s = new Set<string>();
    for (const a of solution.assignments) s.add(assignmentKey(a));
    return s;
  }, [solution.assignments]);

  const pinMap = useMemo(() => {
    const m = new Map<string, Pin>();
    for (const p of pins) m.set(pinKey(p), p);
    return m;
  }, [pins]);

  const assignsByEmp = useMemo(() => {
    const m = new Map<
      string,
      {
        day: number;
        shift: Shift;
        pinned: boolean;
        optimistic: boolean;
        changed: boolean;
      }[]
    >();

    for (const a of solution.assignments) {
      const sh = shiftById.get(a.shift);
      if (!sh) continue;
      const key = assignmentKey(a);
      const pin = pinMap.get(key);
      const list = m.get(a.employee) ?? [];
      list.push({
        day: a.day,
        shift: sh,
        pinned: pin?.value === 1,
        optimistic: false,
        changed: changedKeys?.has(key) ?? false,
      });
      m.set(a.employee, list);
    }

    // Optimistic pin=1 not yet in solution.
    for (const p of pins) {
      if (p.value !== 1) continue;
      const key = pinKey(p);
      if (assignKeys.has(key)) continue;
      const sh = shiftById.get(p.shift);
      if (!sh) continue;
      const list = m.get(p.employee) ?? [];
      list.push({
        day: p.day,
        shift: sh,
        pinned: true,
        optimistic: true,
        changed: changedKeys?.has(key) ?? false,
      });
      m.set(p.employee, list);
    }

    return m;
  }, [solution.assignments, shiftById, pinMap, assignKeys, changedKeys, pins]);

  const uncovered = useMemo(() => emptyOpenPeriods(instance, solution), [instance, solution]);

  const days = instance.horizon_days;
  const periods = 96;
  const employees = instance.employees;

  useEffect(() => {
    if (!rootRef.current) return;
    const update = () => { if (rootRef.current) setTokens(readTokens(rootRef.current)); };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const gridW = tokens ? days * periods * tokens.cellW : 0;
  const gridH = tokens ? employees.length * tokens.rowH : 0;
  const nameW = tokens ? tokens.nameColW + 56 : 204;
  const dayW = tokens ? periods * tokens.cellW : 0;

  const syncView = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setView({
      top: el.scrollTop,
      left: el.scrollLeft,
      w: el.clientWidth,
      h: el.clientHeight,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncView();
    const ro = new ResizeObserver(syncView);
    ro.observe(el);
    el.addEventListener("scroll", syncView, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", syncView);
    };
  }, [syncView, tokens]);

  // Timetable (virtualized rows + columns).
  useEffect(() => {
    const canvas = plotRef.current;
    if (!canvas || !tokens) return;
    const ctx = sizeCanvas(canvas, view.w, view.h);
    if (!ctx) return;

    const vw = Math.max(1, view.w);
    const vh = Math.max(1, view.h);
    ctx.fillStyle = tokens.paper;
    ctx.fillRect(0, 0, vw, vh);

    const { cellW, rowH } = tokens;
    const dayW = periods * cellW;
    const row0 = Math.max(0, Math.floor(view.top / rowH) - 1);
    const row1 = Math.min(
      employees.length,
      Math.ceil((view.top + vh) / rowH) + 1,
    );
    const p0 = Math.max(0, Math.floor(view.left / cellW) - 1);
    const p1 = Math.min(
      days * periods,
      Math.ceil((view.left + vw) / cellW) + 1,
    );

    for (let r = row0; r < row1; r++) {
      const emp = employees[r];
      const y = r * rowH - view.top;
      ctx.fillStyle = r % 2 === 0 ? tokens.paper : tokens.paperSunk;
      ctx.fillRect(0, y, vw, rowH);

      ctx.globalAlpha = 0.38;
      ctx.fillStyle = tokens.alarmFill;
      for (let abs = p0; abs < p1; abs++) {
        const day = Math.floor(abs / periods);
        const period = abs % periods;
        if (uncovered.has(`${day}:${period}`)) ctx.fillRect(abs * cellW - view.left, y, cellW, rowH);
      }
      ctx.globalAlpha = 1;

      for (const block of assignsByEmp.get(emp.id) ?? []) {
        const { day, shift, pinned, optimistic, changed } = block;
        const band = shiftBand(shift);
        const fill =
          changed
            ? tokens.duskFill
            : band === "dawn"
              ? tokens.dawnFill
              : band === "dusk"
                ? tokens.duskFill
                : tokens.dayFill;
        const stroke =
          pinned
            ? tokens.ink
            : changed
              ? tokens.dusk
              : band === "dawn"
                ? tokens.dawn
                : band === "dusk"
                  ? tokens.dusk
                  : tokens.day;
        const x = day * dayW + shift.start_period * cellW - view.left;
        const w = (shift.end_period - shift.start_period) * cellW;
        const pad = 6;
        ctx.globalAlpha = optimistic ? 0.45 : 1;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + pad, w - 2, rowH - pad * 2, 7);
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = pinned ? 2 : 1;
        ctx.stroke();
        if (w > 100) {
          ctx.fillStyle = tokens.ink;
          ctx.font = `600 12px ${tokens.fontDisplay}`;
          ctx.textBaseline = "middle";
          ctx.fillText(`${shift.label} · ${periodLabel(shift.start_period)}–${periodLabel(shift.end_period)}`, x + 12, y + rowH / 2, w - 24);
        }
        if (pinned) {
          // Ink rule on the left edge — pin affordance (not --alarm).
          ctx.fillStyle = tokens.ink;
          ctx.fillRect(x + 1, y + pad + 5, 3, rowH - pad * 2 - 10);
        }
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = tokens.rule;
      ctx.beginPath();
      ctx.moveTo(0, y + rowH - 0.5);
      ctx.lineTo(vw, y + rowH - 0.5);
      ctx.stroke();
    }

    for (let day = 0; day < days; day++) {
      const xDay = day * dayW - view.left;
      ctx.strokeStyle = tokens.inkSoft;
      ctx.beginPath();
      ctx.moveTo(xDay + 0.5, 0);
      ctx.lineTo(xDay + 0.5, vh);
      ctx.stroke();
      for (let h = 2; h < 24; h += 2) {
        const x = xDay + h * 4 * cellW;
        if (x < -2 || x > vw + 2) continue;
        ctx.strokeStyle = tokens.ruleHour;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, vh);
        ctx.stroke();
      }
    }
  }, [tokens, view, employees, days, periods, assignsByEmp, uncovered]);

  // Name + hours column.
  useEffect(() => {
    const canvas = namesRef.current;
    if (!canvas || !tokens) return;
    const ctx = sizeCanvas(canvas, nameW, view.h);
    if (!ctx) return;

    const h = Math.max(1, view.h);
    ctx.fillStyle = tokens.paper;
    ctx.fillRect(0, 0, nameW, h);

    const { rowH, nameColW } = tokens;
    const row0 = Math.max(0, Math.floor(view.top / rowH) - 1);
    const row1 = Math.min(
      employees.length,
      Math.ceil((view.top + h) / rowH) + 1,
    );

    for (let r = row0; r < row1; r++) {
      const emp = employees[r];
      const y = r * rowH - view.top;
      ctx.fillStyle = r % 2 === 0 ? tokens.paper : tokens.paperSunk;
      ctx.fillRect(0, y, nameW, rowH);
      ctx.fillStyle = tokens.ink;
      ctx.font = `500 13px ${tokens.fontDisplay}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(emp.name, 10, y + rowH / 2, nameColW - 16);

      const hrs = hoursByEmp.get(emp.id) ?? 0;
      ctx.fillStyle = tokens.inkSoft;
      ctx.font = `500 12px ${tokens.fontData}`;
      ctx.textAlign = "right";
      ctx.fillText(hrs.toFixed(1), nameW - 10, y + rowH / 2);

      ctx.strokeStyle = tokens.rule;
      ctx.beginPath();
      ctx.moveTo(0, y + rowH - 0.5);
      ctx.lineTo(nameW, y + rowH - 0.5);
      ctx.stroke();
    }

    ctx.strokeStyle = tokens.ruleHour;
    ctx.beginPath();
    ctx.moveTo(nameW - 0.5, 0);
    ctx.lineTo(nameW - 0.5, h);
    ctx.stroke();
  }, [tokens, view, employees, hoursByEmp, nameW]);

  // Day / hour ruler.
  useEffect(() => {
    const canvas = rulerRef.current;
    if (!canvas || !tokens) return;
    const rh = 42;
    const ctx = sizeCanvas(canvas, view.w, rh);
    if (!ctx) return;

    const vw = Math.max(1, view.w);
    ctx.fillStyle = tokens.paperSunk;
    ctx.fillRect(0, 0, vw, rh);

    const { cellW } = tokens;
    const dayW = periods * cellW;
    ctx.font = `600 12px ${tokens.fontDisplay}`;
    ctx.textBaseline = "middle";

    for (let day = 0; day < days; day++) {
      const x0 = day * dayW - view.left;
      ctx.fillStyle = tokens.ink;
      ctx.textAlign = "left";
      ctx.fillText(language === "ro" ? `Ziua ${day + 1}` : `Day ${day + 1}`, x0 + 10, rh / 2);
      ctx.fillStyle = tokens.inkSoft;
      for (let hour = 6; hour <= 22; hour += 2) {
        const x = x0 + hour * 4 * cellW;
        if (x < -40 || x > vw) continue;
        ctx.fillText(periodLabel(hour * 4), x + 2, rh / 2);
      }
      ctx.strokeStyle = tokens.inkSoft;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, 0);
      ctx.lineTo(x0 + 0.5, rh);
      ctx.stroke();
    }
  }, [tokens, view, days, periods, language]);

  const onPlotPointer = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      if (!pinEnabled || !onPin || !tokens || !scrollRef.current) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      if (ev.clientX - rect.left >= ev.currentTarget.clientWidth || ev.clientY - rect.top >= ev.currentTarget.clientHeight) return;
      const x = ev.clientX - rect.left + scrollRef.current.scrollLeft;
      const y = ev.clientY - rect.top + scrollRef.current.scrollTop;
      const row = Math.floor(y / tokens.rowH);
      if (row < 0 || row >= employees.length) return;
      const emp = employees[row];
      const dayW = periods * tokens.cellW;
      const day = Math.floor(x / dayW);
      if (day < 0 || day >= days) return;
      const period = Math.floor((x - day * dayW) / tokens.cellW);
      const shift = shiftAtPeriod(instance.shifts, period);
      if (!shift) return;

      const key = `${emp.id}|${day}|${shift.id}`;
      const existing = pinMap.get(key);
      if (existing) {
        onPin(null, { employee: emp.id, day, shift: shift.id });
        return;
      }
      // Toggle: if already assigned, pin it; if not, pin on (=1).
      onPin(
        { employee: emp.id, day, shift: shift.id, value: 1 },
        { employee: emp.id, day, shift: shift.id },
      );
    },
    [
      pinEnabled,
      onPin,
      tokens,
      employees,
      days,
      periods,
      instance.shifts,
      pinMap,
    ],
  );

  const moveDay = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el || !dayW) return;
    const target = direction > 0
      ? (Math.floor(el.scrollLeft / dayW) + 1) * dayW
      : (Math.ceil(el.scrollLeft / dayW) - 1) * dayW;
    el.scrollTo({ left: Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth)), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  const shellStyle = {
    "--grid-name-w": `${nameW}px`,
    "--grid-content-height": `${Math.min(620, Math.max(260, gridH + 42))}px`,
  } as CSSProperties;

  return (
    <div ref={rootRef} className="schedule-grid">
      <div className="schedule-grid__head">
      <span className="schedule-grid__current">{language === "ro" ? "Vizualizare" : "Viewing"} <b>{language === "ro" ? `Ziua ${Math.min(days, Math.floor(view.left / (dayW || 1)) + 1)}` : `Day ${Math.min(days, Math.floor(view.left / (dayW || 1)) + 1)}`}</b> / {days}</span>
      {pinEnabled ? (
        <p className="schedule-grid__hint">
          {language === "ro" ? "Apăsați pe o tură pentru a o fixa sau a anula fixarea. Pentru a interzice o tură, debifați disponibilitatea angajatului în Personal. Turele fixate au contur închis." : "Click a shift to require or clear it. To prohibit a shift, clear that employee’s availability in Staff. Pinned shifts have a dark rule."}
        </p>
      ) : null}
      <div className="schedule-grid__days"><button type="button" disabled={view.left < 1} onClick={() => moveDay(-1)}>{language === "ro" ? "← Ziua precedentă" : "← Previous day"}</button><button type="button" disabled={view.left >= Math.max(0, gridW - view.w - 1)} onClick={() => moveDay(1)}>{language === "ro" ? "Ziua următoare →" : "Next day →"}</button></div>
      </div>
      <div className="schedule-grid__frame" style={shellStyle}>
        <div className="schedule-grid__corner label">{t(language, "Staff")} / h</div>
        <div className="schedule-grid__ruler">
          <canvas ref={rulerRef} />
        </div>
        <div className="schedule-grid__names">
          <canvas ref={namesRef} onPointerDown={(event) => {
            if (!tokens || !onSelectEmployee) return;
            const row = Math.floor((event.clientY - event.currentTarget.getBoundingClientRect().top + view.top) / tokens.rowH);
            if (employees[row]) onSelectEmployee(employees[row].id);
          }} />
        </div>
        <div className="schedule-grid__chart">
          <div ref={scrollRef} className="schedule-grid__scroll" data-interactive={pinEnabled || undefined} onPointerDown={onPlotPointer}>
            <div style={{ width: gridW, height: gridH }} />
          </div>
          <canvas
            ref={plotRef}
            className="schedule-grid__plot"
          />
        </div>
      </div>
    </div>
  );
}
