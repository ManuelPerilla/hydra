export interface Session { authenticated: boolean; operator: boolean; user: string | null; csrfToken: string; mode: string }
export interface Target { namespace: string; name: string; uid: string; ready: boolean }
export interface Targets { namespace: string; items: Target[]; ready: number; total: number; updatedAt: string | null }
export interface Experiment { id: string; status: string; dryRun: boolean; target: { namespace: string; name: string; uid: string }; createdAt: string; startedAt?: string | null; completedAt?: string | null; recoveryMs?: number | null; message?: string | null; tweetDraft?: string | null }
export interface HydraEvent { sequence: number; type: string; experimentId: string | null; at: string; data: unknown }
export interface EventBatch { items: HydraEvent[]; lastSequence: number; resetRequired: boolean }
export interface Command { namespace: string; podName: string; podUid: string; dryRun: boolean }
export interface Snapshot { session: Session; targets: Targets | null; experiments: Experiment[] }
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); this.name = "ApiError"; }
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const optionalString = (value: unknown): boolean => value == null || string(value);
export function isEvent(value: unknown): value is HydraEvent {
  return object(value) && number(value.sequence) && Number.isSafeInteger(value.sequence) && value.sequence > 0 && string(value.type) && (value.experimentId === null || string(value.experimentId)) && string(value.at);
}
export function isExperiment(value: unknown): value is Experiment {
  return object(value) && string(value.id) && string(value.status) && typeof value.dryRun === "boolean" && string(value.createdAt) && object(value.target) && string(value.target.namespace) && string(value.target.name) && string(value.target.uid) && (value.recoveryMs == null || (number(value.recoveryMs) && value.recoveryMs >= 0)) && optionalString(value.startedAt) && optionalString(value.completedAt) && optionalString(value.message) && optionalString(value.tweetDraft);
}
export function isSession(value: unknown): value is Session {
  return object(value) && typeof value.authenticated === "boolean" && typeof value.operator === "boolean" && (value.user === null || string(value.user)) && string(value.csrfToken) && string(value.mode);
}
export function isTargets(value: unknown): value is Targets {
  return object(value) && string(value.namespace) && number(value.ready) && number(value.total) && Number.isSafeInteger(value.ready) && Number.isSafeInteger(value.total) && value.ready >= 0 && value.total >= value.ready && (value.updatedAt === null || string(value.updatedAt)) && Array.isArray(value.items) && value.total === value.items.length && value.ready === value.items.filter((item) => object(item) && item.ready === true).length && value.items.every((target) => object(target) && string(target.namespace) && string(target.name) && string(target.uid) && typeof target.ready === "boolean");
}
async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) timeout.abort();
  const timer = setTimeout(abort, 10_000);
  try {
    response = await fetch(path, { ...init, signal: timeout.signal, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "network");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
  if (!response.ok) throw new ApiError(response.status, `http_${response.status}`);
  if (response.status === 204) return null;
  try { return await response.json(); } catch { throw new ApiError(response.status, "invalid_response"); }
}
export async function fetchSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  const session = await request("/api/session", { signal });
  if (!isSession(session)) throw new ApiError(200, "invalid_response");
  if (!session.authenticated) return { session, targets: null, experiments: [] };
  const [targets, experiments] = await Promise.all([request("/api/targets", { signal }), request("/api/experiments", { signal })]);
  if (!isTargets(targets) || !object(experiments) || !Array.isArray(experiments.items) || !experiments.items.every(isExperiment)) throw new ApiError(200, "invalid_response");
  return { session, targets, experiments: experiments.items };
}
export async function fetchEvents(after: number, signal?: AbortSignal): Promise<EventBatch> {
  const batch = await request(`/api/events?after=${after}`, { signal });
  if (!object(batch) || !Array.isArray(batch.items) || !batch.items.every(isEvent) || !number(batch.lastSequence) || !Number.isSafeInteger(batch.lastSequence) || batch.lastSequence < 0 || typeof batch.resetRequired !== "boolean") throw new ApiError(200, "invalid_response");
  return batch as unknown as EventBatch;
}
export async function submitExperiment(command: Command, csrfToken: string, key: string): Promise<Experiment> {
  const result = await request("/api/experiments", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken, "Idempotency-Key": key }, body: JSON.stringify(command) });
  if (!isExperiment(result)) throw new ApiError(202, "invalid_response");
  return result;
}
export async function logout(csrfToken: string): Promise<void> { await request("/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } }); }
export function errorKey(error: unknown): "unauthorized" | "forbidden" | "conflict" | "rateLimited" | "serverError" | "invalidResponse" | "unknownError" {
  if (!(error instanceof ApiError)) return "unknownError";
  if (error.code === "invalid_response") return "invalidResponse";
  if (error.status === 401) return "unauthorized";
  if (error.status === 403) return "forbidden";
  if (error.status === 409 || error.status === 412) return "conflict";
  if (error.status === 429) return "rateLimited";
  if (error.status >= 500) return "serverError";
  return "unknownError";
}
export const activeStatuses = new Set(["queued", "running", "claimed", "deleting", "deleted", "recovering"]);
export function hasActiveExperiment(experiments: Experiment[]): boolean { return experiments.some((item) => activeStatuses.has(item.status.toLowerCase())); }
