import { useEffect, useRef, type ReactNode } from "react";
import { t, useLanguage } from "@/lib/i18n";

const labels = ["Business", "People", "Operations", "First schedule"];

export function Walkthrough({ step, children, onBack, onNext, onLater, onExit, canNext }: {
  step: number; children: ReactNode; onBack?: () => void; onNext?: () => void;
  onLater?: () => void; onExit: () => void; canNext?: boolean;
}) {
  const language = useLanguage();
  const tr = (value: string) => t(language, value);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  return <section className="setup-flow" aria-label={tr("Get started")}>
    <header className="setup-flow__head">
      <div><p className="label">{tr("Get started")} · {step} / 4</p><h1 ref={heading} tabIndex={-1}>{tr(labels[step - 1])}</h1></div>
      <div className="setup-flow__actions">{onLater ? <button type="button" className="mital-text-action" onClick={onLater}>{tr("Finish later")}</button> : null}<button type="button" className="mgr-btn" onClick={onExit}>{tr("Exit setup")}</button></div>
    </header>
    <div className="setup-flow__track" role="progressbar" aria-label={tr("Setup progress")} aria-valuemin={0} aria-valuemax={4} aria-valuenow={step}><span style={{ width: `${step * 25}%` }} /></div>
    <div key={step} className="setup-flow__stage">{children}</div>
    {onBack || onNext ? <footer className="setup-flow__foot">
      {onBack ? <button type="button" className="mgr-btn" onClick={onBack}>{tr("Back")}</button> : null}
      {onNext ? <button type="button" className="mgr-btn mgr-btn--primary" disabled={!canNext} onClick={onNext}>{step === 4 ? tr("Open schedule") : tr("Continue")}</button> : null}
    </footer> : null}
  </section>;
}
