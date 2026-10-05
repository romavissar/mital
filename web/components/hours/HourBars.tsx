
import type { Instance, Solution } from "@/lib/types";
import { t, useLanguage } from "@/lib/i18n";

type Props = {
  instance: Instance;
  solution: Solution;
};

export function HourBars({ instance, solution }: Props) {
  const language = useLanguage();
  const byId = new Map(solution.per_employee.map((p) => [p.employee, p]));
  const maxH = Math.max(
    1,
    ...instance.employees.map((e) => byId.get(e.id)?.hours ?? 0),
    ...instance.employees.map((e) => e.max_hours),
  );

  return (
    <div className="hour-bars" aria-label={language === "ro" ? "Ore pe angajat" : "Hours per employee"}>
      <p className="label">{t(language, "Hours")}</p>
      <ul className="hour-bars__list">
        {instance.employees.map((e) => {
          const stats = byId.get(e.id);
          const hours = stats?.hours ?? 0;
          const ot = stats?.overtime_hours ?? 0;
          const pct = (hours / maxH) * 100;
          return (
            <li key={e.id} className="hour-bars__row">
              <span className="hour-bars__name">{e.name}</span>
              <div className="hour-bars__track">
                <div
                  className="hour-bars__fill"
                  style={{ width: `${pct}%` }}
                  data-ot={ot > 0 ? "1" : "0"}
                />
              </div>
              <span className="hour-bars__val num">{hours.toFixed(1)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
