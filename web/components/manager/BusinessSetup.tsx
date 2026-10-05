import { useState } from "react";

import { clockPeriod, createBusiness, localToday, mondayOf } from "@/lib/business";
import type { Instance, Shift } from "@/lib/types";
import { errorText, t, useLanguage } from "@/lib/i18n";
import { WeekPicker } from "@/components/manager/WeekPicker";

type ShiftDraft = { label: string; start: string; end: string; paid: string };
type Props = { onCreate: (name: string, instance: Instance, language: "ro" | "en") => Promise<void> };

export function BusinessSetup({ onCreate }: Props) {
  const initialLanguage = useLanguage();
  const [language, setLanguage] = useState(initialLanguage);
  const tr = (english: string) => t(language, english);
  const [currency, setCurrency] = useState<"RON" | "EUR" | "USD">("RON");
  const [payBasis, setPayBasis] = useState<"monthly_salary" | "hourly">("monthly_salary");
  const [name, setName] = useState("");
  const [week, setWeek] = useState(() => mondayOf(localToday()));
  const [roles, setRoles] = useState(language === "ro" ? "Personal, Responsabil" : "Staff, Supervisor");
  const [supervisor, setSupervisor] = useState(language === "ro" ? "Responsabil" : "Supervisor");
  const [shifts, setShifts] = useState<ShiftDraft[]>([{ label: language === "ro" ? "Zi" : "Day", start: "09:00", end: "17:00", paid: "8" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateShift = (index: number, patch: Partial<ShiftDraft>) => setShifts((old) => old.map((shift, i) => i === index ? { ...shift, ...patch } : shift));

  async function create() {
    try {
      const skills = roles.split(",").map((role) => role.trim()).filter(Boolean);
      if (new Set(skills).size !== skills.length) throw new Error("Role names must be distinct.");
      const parsed: Shift[] = shifts.map((shift, i) => ({
        id: `shift_${i + 1}`, label: shift.label.trim(),
        start_period: clockPeriod(shift.start), end_period: clockPeriod(shift.end),
        paid_hours: Number(shift.paid), undesirable: false, closing: false,
      }));
      if (parsed.some((shift) => !shift.label)) throw new Error("Name every shift.");
      const instance = { ...createBusiness(name, week, skills, supervisor.trim(), parsed), currency, pay_basis: payBasis };
      setBusy(true);
      setError(null);
      await onCreate(name.trim(), instance, language);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  return <section className="mgr-panel" aria-label={tr("Set up your business")}>
    <div className="mgr-panel__head"><div><p className="label">{tr("Get started")}</p><h2 className="mgr-panel__title">{tr("Set up your business")}</h2></div></div>
    <p className="mgr-hint">{language === "ro" ? "Adăugați firma și o primă tură. Apoi completați personalul și necesarul. Datele rămân pe acest computer." : "Add your business and an initial shift. Then complete staff and demand. Data stays on this computer."}</p>
    <div className="mgr-form__row">
      <label className="mgr-field"><span className="label">{tr("Language")}</span><select value={language} onChange={(event) => setLanguage(event.target.value as "ro" | "en")}><option value="ro">Română</option><option value="en">English</option></select></label>
      <label className="mgr-field"><span className="label">{tr("Accounting currency")}</span><select value={currency} onChange={(event) => setCurrency(event.target.value as "RON" | "EUR" | "USD")}><option>RON</option><option>EUR</option><option>USD</option></select></label>
      <label className="mgr-field"><span className="label">{tr("Pay basis")}</span><select value={payBasis} onChange={(event) => setPayBasis(event.target.value as "monthly_salary" | "hourly")}><option value="monthly_salary">{tr("Monthly salaries")}</option><option value="hourly">{tr("Hourly wages")}</option></select></label>
    </div>
    <div className="mgr-form__row">
      <label className="mgr-field"><span className="label">{tr("Business name")}</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Exemplu SRL" /></label>
      <WeekPicker value={week} onChange={setWeek} language={language} label={tr("Week starting Monday")} />
    </div>
    <div className="mgr-form__row">
      <label className="mgr-field"><span className="label">{tr("Roles, separated by commas")}</span><input value={roles} onChange={(event) => setRoles(event.target.value)} /></label>
      <label className="mgr-field"><span className="label">{tr("Supervisor role")}</span><input value={supervisor} onChange={(event) => setSupervisor(event.target.value)} /></label>
    </div>
    <p className="label">{tr("Opening shifts")}</p>
    {shifts.map((shift, index) => <div className="mgr-form__row" key={index}>
      <label className="mgr-field"><span className="label">{tr("Shift name")}</span><input value={shift.label} onChange={(event) => updateShift(index, { label: event.target.value })} /></label>
      <label className="mgr-field"><span className="label">{tr("Start")}</span><input type="time" step="900" value={shift.start} onChange={(event) => updateShift(index, { start: event.target.value })} /></label>
      <label className="mgr-field"><span className="label">{language === "ro" ? "Sfârșit (24:00 = miezul nopții)" : "End (24:00 = midnight)"}</span><input type="text" inputMode="numeric" maxLength={5} placeholder="HH:MM" value={shift.end} onChange={(event) => updateShift(index, { end: event.target.value })} /></label>
      <label className="mgr-field"><span className="label">{tr("Paid hours")}</span><input type="number" min="0.25" step="0.25" value={shift.paid} onChange={(event) => updateShift(index, { paid: event.target.value })} /></label>
      <button type="button" className="mgr-btn" disabled={shifts.length === 1} onClick={() => setShifts((old) => old.filter((_, i) => i !== index))}>{tr("Remove")}</button>
    </div>)}
    <div className="mgr-panel__actions">
      <button type="button" className="mgr-btn" onClick={() => setShifts((old) => [...old, { label: `${language === "ro" ? "Tură" : "Shift"} ${old.length + 1}`, start: "17:00", end: "22:00", paid: "5" }])}>{tr("Add shift")}</button>
      <button type="button" className="mgr-btn mgr-btn--primary" disabled={busy} onClick={() => void create()}>{busy ? tr("Creating…") : tr("Continue")}</button>
    </div>
    {error ? <p className="mgr-hint" data-tone="alarm">{errorText(language, error)}</p> : null}
  </section>;
}
