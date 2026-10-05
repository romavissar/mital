import { createContext, useContext, type ReactNode } from "react";

export type Language = "en" | "ro";

const LanguageContext = createContext<Language>("en");

export function LanguageProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }

const romanian: Record<string, string> = {
  "Schedule": "Program", "Staff": "Personal", "Demand": "Necesar", "Repair": "Ajustare",
  "People": "Personal", "Operations": "Activitate", "Review & publish": "Verificare și publicare",
  "Navigation": "Navigare", "Business": "Firmă", "First schedule": "Primul program",
  "Previous week": "Săptămâna precedentă", "Draft": "Ciornă", "saved": "salvată", "saving": "se salvează", "unsaved": "nesalvată", "error": "eroare",
  "Rebuild": "Recalculează", "Continue": "Continuă", "Finish later": "Continuă mai târziu", "Back": "Înapoi", "Open schedule": "Deschide programul", "Setup progress": "Progresul configurării",
  "Exit setup": "Ieși din configurare", "Your schedules, on this computer.": "Programele dumneavoastră, pe acest computer.", "Start a business or restore a local backup to continue.": "Creați o firmă sau importați o copie locală pentru a continua.",
  "Setup is unfinished.": "Configurarea nu este finalizată.", "Resume setup": "Reia configurarea",
  "You can adjust pay and language later in Settings.": "Puteți ajusta plata și limba mai târziu în Setări.",
  "People ready.": "Personalul este pregătit.", "Add a supervisor, pay, and availability to continue.": "Adăugați un responsabil, plata și disponibilitatea pentru a continua.",
  "Operations ready.": "Activitatea este pregătită.", "Add demand and confirm staff availability to continue.": "Introduceți necesarul și confirmați disponibilitatea personalului pentru a continua.",
  "Build your first schedule": "Creați primul program", "uncovered periods": "intervale neacoperite", "supervisor gaps": "intervale fără responsabil", "Repair schedule": "Ajustează programul", "Insights": "Analiză",
  "Rules that block publishing": "Reguli care blochează publicarea", "Staffing gaps to decide": "Lipsuri de personal de evaluat", "Warnings to check": "Avertismente de verificat",
  "Review": "Verifică",
  "Coverage help": "Ajutor pentru acoperire", "Ways to close gaps": "Soluții pentru lipsuri",
  "Checking options locally…": "Se verifică local variantele…", "Accept change": "Acceptă schimbarea", "Accept & implement": "Acceptă și aplică",
  "Accept & review hiring": "Acceptă și verifică angajarea", "Accept & review person": "Acceptă și verifică persoana",
  "Dismiss": "Respinge", "Suggestion applied": "Sugestie aplicată",
  "Close": "Închide", "Assigned shifts": "Ture atribuite", "Edit person": "Editează angajatul",
  "Available days": "Zile disponibile",
  "Inspect person": "Detalii angajat", "Select person…": "Alegeți un angajat…",
  "Check staff availability after changing shifts.": "Verificați disponibilitatea personalului după modificarea turelor.",
  "Language & appearance": "Limbă și aspect", "Pay": "Plată", "Currency": "Monedă",
  "Open setup walkthrough": "Deschide ghidul de configurare",
  "Your business files are stored on this computer. Export a backup to keep a separate copy.": "Fișierele firmei sunt stocate pe acest computer. Exportați o copie de rezervă pentru păstrare separată.",
  "Shifts": "Ture", "Opening hours and shifts": "Program de lucru și ture", "Apply shifts": "Aplică turele",
  "Publish": "Publicare", "Settings": "Setări", "Demo": "Demo", "Saved weeks": "Săptămâni salvate",
  "Select demo…": "Alegeți un demo…", "Select week…": "Alegeți o săptămână…",
  "New business": "Firmă nouă", "Week of": "Săptămâna din", "Next week": "Săptămâna următoare",
  "Copy last published week": "Copiază ultima săptămână publicată", "Copy previous week": "Copiază săptămâna precedentă", "Published": "Publicat",
  "Build this week’s schedule": "Creați programul săptămânii", "Build schedule": "Generează programul",
  "The draft changed since the last build. Rebuild to review the current schedule.": "Ciorna s-a schimbat după ultimul calcul. Recalculați pentru a vedea programul curent.",
  "Add staff and demand, then build a schedule. Draft changes are saved locally before publishing.": "Adăugați personalul și necesarul, apoi generați programul. Modificările se salvează local înainte de publicare.",
  "Get started": "Începeți", "Set up your business": "Configurați firma",
  "Business name": "Numele firmei", "Week starting Monday": "Săptămâna începe luni",
  "Roles, separated by commas": "Roluri, separate prin virgulă", "Supervisor role": "Rol de responsabil",
  "Opening shifts": "Ture de lucru", "Shift name": "Numele turei", "Start": "Început", "End": "Sfârșit",
  "Paid hours": "Ore plătite", "Remove": "Șterge", "Add shift": "Adaugă tură",
  "Creating…": "Se creează…", "Create business": "Creează firma", "Try a demo instead": "Încercați un demo",
  "People & availability": "Personal și disponibilitate", "Add staff": "Adaugă angajat",
  "Find staff": "Caută angajat", "Search by name": "Caută după nume",
  "Enter a monthly salary to continue.": "Introduceți salariul lunar pentru a continua.", "Select at least one available shift.": "Selectați cel puțin o tură disponibilă.",
  "Tinted cells have required staff; 0 means no demand.": "Celulele colorate cer personal; 0 înseamnă fără necesar.",
  "Remove this employee from the current business?": "Eliminați acest angajat din firma curentă?",
  "Solving…": "Se calculează…", "Apply & re-solve": "Aplică și recalculează",
  "Name": "Nume", "Monthly salary": "Salariu lunar", "Wage / hour": "Tarif orar",
  "Extra overtime cost / hour": "Cost suplimentar pentru ore în plus / oră",
  "Min h": "Min. ore", "Max h": "Max. ore", "Max OT": "Max. ore în plus",
  "Skills": "Competențe", "Availability": "Disponibilitate",
  "Clear availability": "Șterge disponibilitatea", "Add staff to edit.": "Adăugați un angajat pentru editare.",
  "Set salary": "Introduceți salariul", "Coverage by shift band": "Acoperire pe ture",
  "Copy previous day": "Copiază ziua precedentă", "Clear day": "Șterge ziua", "Day": "Ziua",
  "Skill \\ shift": "Competență \\ tură", "Minimal-disruption re-solve": "Recalculare cu modificări minime",
  "Repairing…": "Se ajustează…", "Repair roster": "Ajustează programul",
  "Employee unavailable": "Angajat indisponibil", "Days off": "Zile libere",
  "Pay & currency": "Salarii și monedă", "Save settings": "Salvează setările", "Saving…": "Se salvează…",
  "Pay basis": "Tip de plată", "Hourly wages": "Tarife orare", "Monthly salaries": "Salarii lunare",
  "Accounting currency": "Moneda de evidență", "Display currency": "Moneda afișată",
  "Rate date": "Data cursului", "Rate source": "Sursa cursului", "Language": "Limba",
  "Appearance": "Aspect", "System": "Sistem", "Light": "Luminos", "Dark": "Întunecat",
  "English": "Engleză", "Romanian": "Română", "Checklist & save": "Verificare și salvare",
  "Export CSV": "Exportă CSV",
  "Re-publish": "Publică din nou", "Ready to publish this week.": "Programul este pregătit pentru publicare.",
  "Load published": "Încarcă program publicat", "Select saved roster…": "Alegeți un program salvat…",
  "Local data": "Date locale", "Export backup": "Exportă copie", "Import backup": "Importă copie",
  "Open data folder": "Deschide dosarul datelor", "Restore previous save": "Restaurează salvarea anterioară",
  "No solution yet — solve first": "Nu există program calculat — generați-l mai întâi",
  "No skill coverage shortfalls": "Fără lipsuri de acoperire", "Supervisor on every open period": "Responsabil prezent în fiecare interval deschis",
  "Everyone at or above contracted minimum": "Toți angajații ating minimul contractat",
  "No manager pins": "Fără ture fixate", "Print": "Tipărire", "Hours": "Ore",
  "planning cost": "cost estimat", "Estimated pay": "Cost estimat al personalului", "week of": "săptămâna din", "Unsupported accounting currency": "Monedă de evidență neacceptată",
  "Fairness tradeoff": "Cost și echitate", "precomputed": "precalculat", "live": "actual",
  "Cost and fairness": "Cost și echitate", "Schedule options": "Variante de program", "Choose a point to preview": "Alegeți o variantă pentru previzualizare",
  "Compare schedules with the same shift coverage. Choose one to preview before publishing.": "Comparați variante cu același nivel de acoperire a turelor. Alegeți una pentru previzualizare înainte de publicare.",
  "Calculating options locally…": "Se calculează variantele local…", "Build the schedule to compare cost and fairness.": "Generați programul pentru a compara costul și echitatea.",
  "Clear pinned shifts to compare schedule options.": "Anulați turele fixate pentru a compara variantele de program.",
  "Selected variant is a draft until published.": "Varianta aleasă rămâne ciornă până la publicare.", "Options could not be calculated.": "Variantele nu au putut fi calculate.", "Try again": "Încearcă din nou",
  "cheaper": "mai ieftin", "fairer": "mai echitabil", "Solve inspector": "Detalii calcul",
  "Status": "Stare", "MIP gap": "Diferență MIP", "Solve time": "Timp de calcul",
  "Binding (gutter)": "Constrângeri active", "Term": "Componentă", "Wages": "Tarife",
  "Salaries (period share)": "Salarii (cotă perioadă)", "Overtime": "Ore suplimentare",
  "Understaffing": "Personal insuficient", "Supervisor": "Responsabil", "Min hours": "Ore minime",
  "Unfairness": "Inechitate", "Preference": "Preferințe", "Total": "Total",
  "Marginal costs": "Costuri marginale", "Sampled marginals": "Costuri marginale estimate",
  "Computing…": "Se calculează…", "Computing sampled marginals…": "Se calculează estimările…",
  "Failed": "Eșuat", "No binding coverage rows to probe.": "Nu există intervale active de verificat.",
  "coverage penalty only": "doar penalizare pentru acoperire",
  "Settings saved": "Setările au fost salvate", "Backup exported": "Copia a fost exportată",
  "Backup imported": "Copia a fost importată", "Previous save restored": "Salvarea anterioară a fost restaurată",
  "Repaired": "Ajustat", "CSV exported": "CSV exportat",
  "Only a feasible schedule can be published.": "Se poate publica doar un program fezabil.",
  "optimal": "optim", "feasible": "fezabil", "infeasible": "imposibil", "timeout": "timp expirat",
  "Dial hidden — instance edited or pins active (cache skipped).": "Comparația nu este disponibilă când datele sau turele fixate se schimbă.",
  "Dial hidden after repair.": "Comparația nu este disponibilă după ajustare.",
  "Loaded published roster — dial cache may not apply.": "Program publicat încărcat; comparația precalculată poate să nu se aplice.",
  "Dial hidden — edit instance or clear pins to use the committed frontier cache.": "Comparația este ascunsă când datele sunt editate sau există ture fixate.",
  "Live frontier — dial hidden. Precomputed stops are only shown for unmodified committed instances.": "Comparația este ascunsă. Variantele precalculate apar numai pentru datele demo nemodificate.",
  "Build the schedule again after editing before publishing.": "Recalculați programul după editare, înainte de publicare.",
  "No earlier published week is available to copy.": "Nu există o săptămână publicată anterior pentru copiere.",
  "Solve or publish a roster before repair.": "Calculați sau publicați un program înainte de ajustare.",
  "Open the desktop app to print a schedule.": "Deschideți aplicația desktop pentru tipărire.",
  "Saved business could not be opened. Try restoring its previous save.": "Datele firmei nu au putut fi deschise. Încercați restaurarea salvării anterioare.",
  "No previous save exists for this week.": "Nu există o salvare anterioară pentru această săptămână.",
  "The previous save is damaged.": "Salvarea anterioară este deteriorată.",
  "Enter a positive monthly salary for every employee.": "Introduceți un salariu lunar pozitiv pentru fiecare angajat.",
  "Extra overtime cost must be at least the hourly wage for every employee.": "Costul suplimentar pentru ore în plus trebuie să fie cel puțin egal cu tariful orar pentru fiecare angajat.",
  "Add staff before building the schedule.": "Adăugați personalul înainte de calcularea programului.",
  "Add demand before building the schedule.": "Introduceți necesarul înainte de calcularea programului.",
  "Exchange rates must be positive, finite numbers.": "Cursurile trebuie să fie numere pozitive și finite.",
  "Enter a rate source and date before converting.": "Introduceți sursa și data cursului înainte de conversie.",
  "Enter a valid rate date that is not in the future.": "Introduceți o dată validă a cursului, care nu este în viitor.",
  "Enter valid rates to preview the conversion.": "Introduceți cursuri valide pentru previzualizare.",
  "Role names must be distinct.": "Rolurile trebuie să aibă nume diferite.",
  "Name every shift.": "Dați un nume fiecărei ture.",
  "Name every shift distinctly.": "Fiecare tură trebuie să aibă un nume diferit.",
  "Add at least one shift.": "Adăugați cel puțin o tură.",
  "Enter a business name.": "Introduceți numele firmei.",
  "Choose a supervisor skill.": "Alegeți competența responsabilului.",
  "Add shifts with distinct names.": "Adăugați ture cu nume diferite.",
  "Choose a valid week date.": "Alegeți o dată validă pentru săptămână.",
  "Use HH:MM for shift times.": "Folosiți HH:MM pentru orele turelor.",
  "Shift times must use 15-minute steps between 00:00 and 24:00.": "Orele turelor trebuie să fie în pași de 15 minute între 00:00 și 24:00.",
};

export function t(language: Language, english: string): string {
  return language === "ro" ? romanian[english] ?? english : english;
}

export function errorText(language: Language, message: string): string {
  if (/ot_wage.*< wage|Extra overtime cost must be at least/.test(message)) return language === "ro"
    ? "Costul suplimentar pentru o oră de muncă peste program trebuie să fie cel puțin egal cu salariul orar. Corectați valoarea în Personal."
    : "The extra overtime cost must be at least the hourly wage. Update it in People.";
  if (/minimum people per shift exceeds maximum|Check the minimum and maximum people per shift/.test(message)) return language === "ro"
    ? "Verificați limitele de personal pe tură: maximul trebuie să fie cel puțin egal cu minimul."
    : "Check the people per shift limits: the maximum must be at least the minimum.";
  if (message === "No earlier saved week is available to copy.") return language === "ro" ? "Nu există o săptămână salvată anterior pentru copiere." : message;
  if (/Error invoking remote method|validation error for SolveRequest|pydantic.dev/.test(message)) return language === "ro"
    ? "Programul nu a putut fi calculat. Verificați salariile, disponibilitatea și regulile, apoi încercați din nou."
    : "The schedule could not be built. Check pay, availability and staffing rules, then try again.";
  if (language !== "ro") return message;
  const rate = /^Enter a positive RON per (EUR|USD) rate\.$/.exec(message);
  if (rate) return `Introduceți un curs RON pozitiv pentru ${rate[1]}.`;
  const shift = /^Check the times and paid hours for (.*)\.$/.exec(message);
  if (shift) return `Verificați orele și durata plătită pentru ${shift[1]}.`;
  return t(language, message);
}
