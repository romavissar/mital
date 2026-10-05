import { useState } from "react";

import {
  formatMoney,
  rateNote,
  validateConversion,
  type Currency,
  type CurrencySettings as Settings,
} from "@/lib/currency";
import type { Instance } from "@/lib/types";
import { errorText, t } from "@/lib/i18n";

type Props = {
  accounting: Currency;
  instance: Instance;
  settings: Settings;
  onSave: (settings: Settings, instance: Instance) => Promise<void>;
  currentSavedId: string | null;
  backupStatus: "checking" | "available" | "missing" | "damaged";
  onExportBackup: (id: string) => void;
  onImportBackup: () => void;
  onOpenDataFolder: () => void;
  onRecoverBusiness: (id: string) => void;
  onResumeSetup: () => void;
  feedback?: string | null;
};

export function SettingsPanel({ accounting, instance, settings, onSave, currentSavedId, backupStatus, onExportBackup, onImportBackup, onOpenDataFolder, onRecoverBusiness, onResumeSetup, feedback }: Props) {
  const [draft, setDraft] = useState(settings);
  const [payDraft, setPayDraft] = useState(() => structuredClone(instance));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tr = (english: string) => t(draft.language, english);

  async function save() {
    try {
      validateConversion(accounting, draft);
      const min = payDraft.rules.min_people_per_shift ?? 1;
      const max = payDraft.rules.max_people_per_shift;
      if (!Number.isInteger(min) || min < 0 || (max != null && (!Number.isInteger(max) || max < Math.max(1, min)))) {
        throw new Error("Check the minimum and maximum people per shift.");
      }
      if (payDraft.rules.supervision_required && max === 1) {
        throw new Error(draft.language === "ro" ? "Supravegherea obligatorie necesită cel puțin două persoane pe tură." : "Mandatory supervision needs a maximum of at least two people per shift.");
      }
      setBusy(true);
      setError(null);
      await onSave(draft, payDraft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const updateFx = (key: keyof Settings["fx"], value: string) => {
    setDraft((old) => ({
      ...old,
      fx: { ...old.fx, [key]: key.startsWith("ron_per_") ? (value === "" ? null : Number(value)) : value },
    }));
  };

  const updateSalary = (id: string, value: string) => {
    setPayDraft((old) => ({
      ...old,
      employees: old.employees.map((employee) => employee.id === id
        ? { ...employee, monthly_salary: value === "" ? null : Number(value) }
        : employee),
    }));
  };

  let preview = tr("Enter valid rates to preview the conversion.");
  if (accounting !== draft.display_currency) {
    try {
      preview = `${formatMoney(100, accounting, draft)} per 100 ${accounting} · ${rateNote(accounting, draft)}`;
    } catch { /* The Save action shows the specific validation error. */ }
  }

  return (
    <section className="mgr-panel mital-settings" aria-label={tr("Settings")}>
      <div className="mgr-panel__head">
        <div>
          <p className="label">{tr("Settings")}</p>
          <h2 className="mgr-panel__title">{tr("Language & appearance")}</h2>
        </div>
        <button type="button" className="mgr-btn mgr-btn--primary" disabled={busy} onClick={() => void save()}>
          {busy ? tr("Saving…") : tr("Save settings")}
        </button>
      </div>
      {feedback ? <p className="mgr-toast" role="status">{tr(feedback)}</p> : null}
      <div className="mgr-form__row">
        <label className="mgr-field">
          <span className="label">{tr("Language")}</span>
          <select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as "ro" | "en" })}>
            <option value="ro">{tr("Romanian")}</option><option value="en">{tr("English")}</option>
          </select>
        </label>
        <label className="mgr-field">
          <span className="label">{tr("Appearance")}</span>
          <select value={draft.appearance ?? "system"} onChange={(event) => setDraft({ ...draft, appearance: event.target.value as "system" | "light" | "dark" })}>
            <option value="system">{tr("System")}</option><option value="light">{tr("Light")}</option><option value="dark">{tr("Dark")}</option>
          </select>
        </label>
      </div>
      <button type="button" className="mital-text-action mital-settings__walkthrough" onClick={onResumeSetup}>{tr("Open setup walkthrough")}</button>
      <h3 className="mital-settings__heading">{draft.language === "ro" ? "Personal pe tură" : "People per shift"}</h3>
      <div className="mgr-form__row">
        <label className="mgr-field"><span className="label">{draft.language === "ro" ? "Minim de persoane" : "Minimum people"}</span>
          <input type="number" min="0" step="1" value={payDraft.rules.min_people_per_shift ?? 1} onChange={(event) => setPayDraft((old) => ({ ...old, rules: { ...old.rules, min_people_per_shift: Number(event.target.value) } }))} /></label>
        <label className="mgr-field"><span className="label">{draft.language === "ro" ? "Maxim de persoane (opțional)" : "Maximum people (optional)"}</span>
          <input type="number" min="1" step="1" placeholder={draft.language === "ro" ? "Fără limită" : "No limit"} value={payDraft.rules.max_people_per_shift ?? ""} onChange={(event) => setPayDraft((old) => ({ ...old, rules: { ...old.rules, max_people_per_shift: event.target.value === "" ? null : Number(event.target.value) } }))} /></label>
      </div>
      <p className="mgr-hint">{draft.language === "ro" ? "Minimul se aplică turelor cu necesar de personal. Maximul nu poate fi depășit. Cu maximul 1, un angajat poate lucra singur; un responsabil nu este programat singur." : "The minimum applies to shifts with staffing demand. The maximum is a firm cap. With a maximum of 1, a regular employee may work alone; a supervisor is never assigned alone."}</p>
      <label className="mgr-field"><span className="label">{draft.language === "ro" ? "Supravegherea angajaților" : "Employee supervision"}</span>
        <select value={String(payDraft.rules.supervision_required ?? payDraft.rules.max_people_per_shift !== 1)} onChange={(event) => setPayDraft((old) => ({ ...old, rules: { ...old.rules, supervision_required: event.target.value === "true" } }))}>
          <option value="true">{draft.language === "ro" ? "Obligatorie" : "Required"}</option><option value="false">{draft.language === "ro" ? "Opțională" : "Optional"}</option>
        </select></label>
      <p className="mgr-hint">{draft.language === "ro" ? "Dacă este obligatorie, intervalele cu angajați fără responsabil blochează publicarea. Dacă este opțională, angajații pot lucra fără responsabil. Un responsabil nu poate fi programat singur în niciun caz." : "When required, periods with employees but no supervisor block publishing. When optional, employees may work without one. A supervisor is never scheduled alone."}</p>
      <h3 className="mital-settings__heading">{tr("Pay")}</h3>
      <label className="mgr-field">
        <span className="label">{tr("Pay basis")}</span>
        <select value={payDraft.pay_basis ?? "hourly"} onChange={(event) => setPayDraft({ ...payDraft, pay_basis: event.target.value as "hourly" | "monthly_salary" })}>
          <option value="hourly">{tr("Hourly wages")}</option>
          <option value="monthly_salary">{tr("Monthly salaries")}</option>
        </select>
      </label>
      {payDraft.pay_basis === "monthly_salary" ? (
        <div className="mgr-salary-list">
          <p className="mgr-hint">{draft.language === "ro" ? `Introduceți salariul lunar al fiecărui angajat în ${accounting}. Estimarea include o cotă fixă pe zile calendaristice, chiar și fără tură atribuită. Costul pentru ore suplimentare este estimat separat. Acestea sunt costuri de planificare, nu stat de plată.` : `Enter each employee’s monthly salary in ${accounting}. The schedule includes a fixed calendar-day share of salary for every employee, even without an assigned shift. Overtime remains an extra hourly estimate set in Staff. These are planning costs, not payroll.`}</p>
          {payDraft.employees.map((employee) => (
            <label className="mgr-field" key={employee.id}>
              <span className="label">{employee.name} · {tr("Monthly salary").toLowerCase()} ({accounting})</span>
              <input type="number" min="0.01" step="0.01" value={employee.monthly_salary ?? ""} onChange={(event) => updateSalary(employee.id, event.target.value)} />
            </label>
          ))}
        </div>
      ) : null}
      <h3 className="mital-settings__heading">{tr("Currency")}</h3>
      <p className="mgr-hint">{tr("Accounting currency")}: <strong>{accounting}</strong>. {draft.language === "ro" ? `Sumele introduse și costurile calculate rămân în ${accounting}; conversia afișată nu modifică programul.` : `Pay inputs and solver costs stay in ${accounting}; display conversion does not alter the roster.`}</p>
      <div className="mgr-form__row">
        <label className="mgr-field">
          <span className="label">{tr("Display currency")}</span>
          <select value={draft.display_currency} onChange={(event) => setDraft({ ...draft, display_currency: event.target.value as Currency })}>
            <option value="RON">RON</option><option value="EUR">EUR</option><option value="USD">USD</option>
          </select>
        </label>
        <label className="mgr-field">
          <span className="label">{tr("Rate date")}</span>
          <input type="date" value={draft.fx.date} onChange={(event) => updateFx("date", event.target.value)} />
        </label>
        <label className="mgr-field">
          <span className="label">{tr("Rate source")}</span>
          <input value={draft.fx.source} placeholder={draft.language === "ro" ? "de ex. buletinul băncii" : "e.g. bank bulletin"} onChange={(event) => updateFx("source", event.target.value)} />
        </label>
      </div>
      <div className="mgr-form__row">
        {(["ron_per_eur", "ron_per_usd"] as const).map((key) => (
          <label className="mgr-field" key={key}>
            <span className="label">1 {key === "ron_per_eur" ? "EUR" : "USD"} = RON</span>
            <input type="number" min="0" step="any" value={draft.fx[key] ?? ""} onChange={(event) => updateFx(key, event.target.value)} />
          </label>
        ))}
      </div>
      <p className="mgr-hint">{draft.language === "ro" ? "Introduceți numai cursurile necesare conversiei. Sunt valori orientative introduse de dumneavoastră; aplicația nu le descarcă automat." : "Enter only the rates needed for your conversion. Rates are planning figures, entered by you, and never fetched automatically."}</p>
      {error ? <p className="mgr-hint" data-tone="alarm">{errorText(draft.language, error)}</p> : null}
      {accounting !== draft.display_currency && !error ? (
        <p className="mgr-hint num">{preview}</p>
      ) : null}
      <h3 className="mital-settings__heading">{tr("Local data")}</h3>
      <p className="mgr-hint">{tr("Your business files are stored on this computer. Export a backup to keep a separate copy.")}</p>
      <div className="mgr-panel__actions">
        <button type="button" className="mgr-btn" disabled={!currentSavedId} onClick={() => currentSavedId && onExportBackup(currentSavedId)}>{tr("Export backup")}</button>
        <button type="button" className="mgr-btn" onClick={onImportBackup}>{tr("Import backup")}</button>
        <button type="button" className="mgr-btn" onClick={onOpenDataFolder}>{tr("Open data folder")}</button>
        <button type="button" className="mgr-btn" disabled={!currentSavedId || backupStatus !== "available"} onClick={() => currentSavedId && onRecoverBusiness(currentSavedId)}>{tr("Restore previous save")}</button>
      </div>
      {backupStatus === "damaged" ? <p className="mgr-hint" data-tone="alarm">{tr("The previous save is damaged.")}</p> : null}
      {backupStatus === "missing" ? <p className="mgr-hint">{tr("No previous save exists for this week.")}</p> : null}
    </section>
  );
}
