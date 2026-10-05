/** Read a design token from :root. No hex literals in components. */

export function cssVar(name: string, el?: Element | null): string {
  const target = el ?? document.documentElement;
  const v = getComputedStyle(target).getPropertyValue(name).trim();
  if (!v) throw new Error(`missing CSS variable ${name}`);
  return v;
}

export function cssPx(name: string, el?: Element | null): number {
  const raw = cssVar(name, el);
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) throw new Error(`CSS variable ${name} is not a length: ${raw}`);
  return n;
}
