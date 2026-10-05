import { useEffect, useRef, useState } from "react";

import { useLanguage } from "@/lib/i18n";

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parse = (value: string) => new Date(`${value}T12:00:00`);
const monday = (date: Date) => {
  const start = new Date(date);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return iso(start);
};

export function WeekPicker({ value, onChange, language: chosenLanguage, label }: { value: string; onChange: (value: string) => void; language?: "ro" | "en"; label?: string }) {
  const appLanguage = useLanguage();
  const language = chosenLanguage ?? appLanguage;
  const locale = language === "ro" ? "ro-RO" : "en-GB";
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parse(value));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setMonth(parse(value)); }, [value]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key === "Escape") setOpen(false);
      if (event.type === "pointerdown" && !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(first);
    day.setDate(day.getDate() + index);
    return day;
  });
  const changeMonth = (offset: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1, 12));
  return <div className="week-picker mgr-field" ref={root}>
    <span className="label">{label ?? (language === "ro" ? "Săptămâna din" : "Week of")}</span>
    <button type="button" className="week-picker__trigger" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(parse(value))}
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2" y="4" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M2 8h16M6 2v4M14 2v4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
    </button>
    {open ? <div className="week-picker__popover" role="dialog" aria-label={language === "ro" ? "Alegeți săptămâna" : "Choose week"}>
      <div className="week-picker__month"><strong>{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month)}</strong><div><button type="button" aria-label={language === "ro" ? "Luna precedentă" : "Previous month"} onClick={() => changeMonth(-1)}>←</button><button type="button" aria-label={language === "ro" ? "Luna următoare" : "Next month"} onClick={() => changeMonth(1)}>→</button></div></div>
      <div className="week-picker__calendar">
        {days.slice(0, 7).map((day) => <span key={`head-${iso(day)}`}>{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(day)}</span>)}
        {days.map((day) => <button type="button" key={iso(day)} aria-label={new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(day)} aria-pressed={monday(day) === value} data-selected={iso(day) === value || undefined} data-week={monday(day) === value || undefined} data-outside={day.getMonth() !== month.getMonth() || undefined} onClick={() => { onChange(monday(day)); setOpen(false); }}>{day.getDate()}</button>)}
      </div>
    </div> : null}
  </div>;
}
