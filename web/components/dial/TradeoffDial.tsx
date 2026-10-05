
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { ParetoPoint } from "@/lib/types";
import { DIAL_MIN_POINTS } from "@/lib/types";
import { formatMoney, type Currency, type CurrencySettings } from "@/lib/currency";
import { t, useLanguage } from "@/lib/i18n";

type Props = {
  frontier: ParetoPoint[];
  index: number | null;
  onChange: (index: number) => void;
  accounting: Currency;
  settings: CurrencySettings;
  source?: "cache" | "live";
  disabled?: boolean;
  note?: string | null;
};

export function TradeoffDial({
  frontier,
  index,
  onChange,
  accounting,
  settings,
  source = "live",
  disabled = false,
  note = null,
}: Props) {
  const language = useLanguage();
  const tr = (english: string) => t(language, english);
  const labelId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const usable = frontier.length >= DIAL_MIN_POINTS && !disabled;
  const n = frontier.length;
  const safeIndex = Math.max(0, Math.min(index ?? 0, Math.max(n - 1, 0)));
  const selected = index !== null;
  const point = n > 0 ? frontier[safeIndex] : null;

  const indexFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || n < 2) return 0;
      const rect = el.getBoundingClientRect();
      const t = (clientX - rect.left) / Math.max(rect.width, 1);
      const clamped = Math.min(1, Math.max(0, t));
      return Math.round(clamped * (n - 1));
    },
    [n],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!usable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(indexFromClientX(e.clientX));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !usable) return;
    onChange(indexFromClientX(e.clientX));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!usable) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(selected ? Math.min(n - 1, safeIndex + 1) : 0);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, safeIndex - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(n - 1);
    }
  };

  // Keep index in range if frontier shrinks.
  useEffect(() => {
    if (n > 0 && index !== null && index !== safeIndex) onChange(safeIndex);
  }, [n, index, safeIndex, onChange]);

  if (n < DIAL_MIN_POINTS) {
    return (
      <div className="dial dial--static">
        <p className="label">{tr("Fairness tradeoff")}</p>
        <p className="dial__note">{n === 1
          ? language === "ro" ? "Un singur program respectă nivelul actual de acoperire. Puteți vedea această variantă mai jos." : "One schedule meets the current coverage level. You can preview it below."
          : language === "ro" ? "Nu există încă o variantă de comparat. Recalculați programul." : "No schedule option is available yet. Rebuild the schedule."}</p>
        {point ? <button type="button" className="mgr-btn" onClick={() => onChange(0)}>{language === "ro" ? "Vezi varianta" : "Preview schedule"} · {formatMoney(point.cost, accounting, settings, 0)} · {point.max_deviation_hours.toFixed(1)} h</button> : null}
      </div>
    );
  }

  if (disabled) {
    return (
      <div className="dial dial--static">
        <p className="label">{tr("Fairness tradeoff")}</p>
        <p className="dial__note">
          {note ?? (language === "ro" ? "Variantele nu mai corespund datelor curente. Recalculați programul." : "Frontier is stale for this instance. The dial hides until the schedule matches a committed instance again.")}
        </p>
      </div>
    );
  }

  const pct = n <= 1 ? 0 : (safeIndex / (n - 1)) * 100;

  return (
    <div className="dial">
      <div className="dial__head">
        <p className="label" id={labelId}>
          {tr("Fairness tradeoff")}
        </p>
        <p className="dial__readout num">
          {selected && point
            ? `${formatMoney(point.cost, accounting, settings, 0)} · ${language === "ro" ? "abatere maximă" : "maximum hours difference"} ${point.max_deviation_hours.toFixed(1)} h · ${safeIndex + 1}/${n}`
            : tr("Choose a point to preview")}
        </p>
        <p className="dial__source label">
          {tr(source === "cache" ? "precomputed" : "live")}
        </p>
      </div>

      <div
        ref={trackRef}
        className="dial__track"
        role="slider"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={safeIndex}
        aria-valuetext={
          selected && point
            ? language === "ro" ? `cost ${formatMoney(point.cost, accounting, settings, 0)}, abatere maximă ${point.max_deviation_hours.toFixed(1)} ore` : `cost ${formatMoney(point.cost, accounting, settings, 0)}, max deviation ${point.max_deviation_hours.toFixed(1)} hours`
            : undefined
        }
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="dial__rail" />
        <div className="dial__fill" style={{ width: `${selected ? pct : 0}%` }} />
        {frontier.map((p, i) => {
          const left = n <= 1 ? 0 : (i / (n - 1)) * 100;
          return (
            <button
              key={`${p.epsilon}-${i}`}
              type="button"
              className={
                selected && i === safeIndex ? "dial__tick dial__tick--active" : "dial__tick"
              }
              style={{ left: `${left}%` }}
              aria-label={`${language === "ro" ? "Variantă" : "Stop"} ${i + 1}: cost ${formatMoney(p.cost, accounting, settings, 0)}, z ${p.max_deviation_hours.toFixed(1)}`}
              onClick={() => onChange(i)}
            />
          );
        })}
        {selected ? <div
          className="dial__thumb"
          style={{ left: `${pct}%` }}
          aria-hidden
        /> : null}
      </div>

      <div className="dial__axis">
        <span>{language === "ro" ? "Cost estimat mai mic" : "Lower estimated pay"}</span>
        <span>{language === "ro" ? "Cost estimat mai mare" : "Higher estimated pay"}</span>
      </div>
      <div className="dial__choices" aria-label={language === "ro" ? "Variante de program" : "Schedule choices"}>
        {frontier.map((p, i) => <button key={`${p.epsilon}-${i}`} type="button" className="dial__choice" data-active={selected && i === safeIndex || undefined} onClick={() => onChange(i)}>
          <span className="label">{language === "ro" ? "Varianta" : "Option"} {i + 1}</span>
          <strong className="num">{formatMoney(p.cost, accounting, settings, 0)}</strong>
          <span>{language === "ro" ? "Abatere ore" : "Hours difference"} {p.max_deviation_hours.toFixed(1)} h</span>
          <small>{(p.solution.shortfall_person_periods / 4).toFixed(1)} {language === "ro" ? "ore-personal lipsă" : "staff-hours short"} · {p.solution.objective.supervisor_gap} {language === "ro" ? "intervale fără responsabil" : "supervision gaps"}</small>
        </button>)}
      </div>
      {note ? <p className="dial__note">{note}</p> : null}
    </div>
  );
}
