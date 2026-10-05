export type Currency = "RON" | "EUR" | "USD";

export type CurrencySettings = {
  language: "ro" | "en";
  appearance?: "system" | "light" | "dark";
  onboarding?: "active" | "later" | "done";
  onboarding_step?: number;
  display_currency: Currency;
  fx: {
    date: string;
    source: string;
    ron_per_eur: number | null;
    ron_per_usd: number | null;
  };
};

export function isCurrency(value: string): value is Currency {
  return value === "RON" || value === "EUR" || value === "USD";
}

export function defaultCurrencySettings(accounting: Currency, language: "ro" | "en" = "en"): CurrencySettings {
  return {
    language,
    appearance: "system",
    display_currency: accounting,
    fx: { date: "", source: "", ron_per_eur: null, ron_per_usd: null },
  };
}

function rate(currency: Currency, fx: CurrencySettings["fx"]): number {
  if (currency === "RON") return 1;
  const value = currency === "EUR" ? fx.ron_per_eur : fx.ron_per_usd;
  if (value === null || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Enter a positive RON per ${currency} rate.`);
  }
  return value;
}

export function validateConversion(accounting: Currency, settings: CurrencySettings): void {
  const { display_currency: display, fx } = settings;
  for (const value of [fx.ron_per_eur, fx.ron_per_usd]) {
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      throw new Error("Exchange rates must be positive, finite numbers.");
    }
  }
  if (accounting === display && fx.ron_per_eur === null && fx.ron_per_usd === null) return;
  if (!fx.source.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fx.date)) {
    throw new Error("Enter a rate source and date before converting.");
  }
  const date = new Date(`${fx.date}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== fx.date || date.getTime() > Date.now()) {
    throw new Error("Enter a valid rate date that is not in the future.");
  }
  if (accounting !== display) {
    rate(accounting, fx);
    rate(display, fx);
  }
}

export function convertMoney(amount: number, accounting: Currency, settings: CurrencySettings): number {
  if (!Number.isFinite(amount)) throw new Error("Invalid monetary amount.");
  validateConversion(accounting, settings);
  if (accounting === settings.display_currency) return amount;
  return amount * rate(accounting, settings.fx) / rate(settings.display_currency, settings.fx);
}

export function formatMoney(amount: number, accounting: Currency, settings: CurrencySettings, digits = 2): string {
  const locale = settings.language === "ro" ? "ro-RO" : "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: settings.display_currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(convertMoney(amount, accounting, settings));
}

export function rateNote(accounting: Currency, settings: CurrencySettings, today = new Date()): string | null {
  if (accounting === settings.display_currency) return null;
  const ageDays = Math.floor((today.getTime() - new Date(`${settings.fx.date}T00:00:00Z`).getTime()) / 86_400_000);
  if (settings.language === "ro") return `Convertit din ${accounting} · curs din ${settings.fx.date} (${settings.fx.source})${ageDays > 30 ? " · curs mai vechi de 30 de zile" : ""}`;
  return `Converted from ${accounting} · rates ${settings.fx.date} (${settings.fx.source})${ageDays > 30 ? " · rates older than 30 days" : ""}`;
}
