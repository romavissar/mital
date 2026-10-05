import type {
  Instance,
  MarginsResponse,
  ParetoResponse,
  Pin,
  SavedRoster,
  Solution,
  SolveMode,
} from "./types";

function desktop(): NonNullable<Window["mital"]> {
  if (!window.mital) {
    throw new Error("Open mital in the desktop app to use the local solver.");
  }
  return window.mital;
}

export function solveInstance(
  instance: Instance,
  opts: {
    time_limit_s?: number;
    mip_gap?: number;
    duals?: boolean;
    mode?: SolveMode;
    pins?: Pin[];
  } = {},
): Promise<Solution> {
  return desktop().solver<Solution>("solve", {
    instance,
    mode: opts.mode ?? "solve",
    fairness: "minmax_hours",
    time_limit_s: opts.time_limit_s ?? 8,
    mip_gap: opts.mip_gap ?? 0.02,
    pins: opts.pins ?? [],
  }, { duals: opts.duals });
}

export function repairInstance(
  instance: Instance,
  published: Solution,
  opts: { time_limit_s?: number; mip_gap?: number } = {},
): Promise<Solution> {
  return desktop().solver<Solution>("repair", {
    instance,
    mode: "repair",
    fairness: "minmax_hours",
    time_limit_s: opts.time_limit_s ?? 8,
    mip_gap: opts.mip_gap ?? 0.02,
    published,
  });
}

export function fetchPareto(
  instance: Instance,
  opts: { pareto_points?: number; time_limit_s?: number; pins?: Pin[] } = {},
): Promise<ParetoResponse> {
  return desktop().solver<ParetoResponse>("pareto", {
    instance,
    mode: "pareto",
    fairness: "minmax_hours",
    time_limit_s: opts.time_limit_s ?? 5,
    mip_gap: 0.02,
    pareto_points: opts.pareto_points ?? 12,
    pins: opts.pins ?? [],
  });
}

export async function fetchMargins(
  instance: Instance,
  solution: Solution,
  opts: { top_n?: number; signal?: AbortSignal; pins?: Pin[] } = {},
): Promise<MarginsResponse> {
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const result = await desktop().solver<MarginsResponse>("margins", {
    instance,
    solution,
    fairness: "minmax_hours",
    top_n: opts.top_n ?? 10,
    perturb_time_limit_s: 2.5,
    pins: opts.pins ?? [],
  });
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return result;
}

export function listSaved(): Promise<string[]> {
  return desktop().listSaved();
}

export function getSaved(docId: string): Promise<SavedRoster> {
  return desktop().getSaved(docId);
}

export function putSaved(docId: string, body: SavedRoster): Promise<SavedRoster> {
  return desktop().putSaved(docId, body);
}

export function savedDocId(instance: Instance): string {
  return `${instance.id}-${instance.start_date}`;
}
