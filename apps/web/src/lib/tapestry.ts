import type { Experiment, Target, Targets } from "./api";

export type PatchState = "ready" | "unready" | "deleted";
export interface PodPatch {
  uid: string;
  name: string;
  namespace: string;
  kind: "current" | "history";
  state: PatchState;
  ready: boolean | null;
  experimentId?: string;
  recoveryRecorded: boolean;
  recoveryMs?: number;
}
export interface Tapestry {
  nodes: PodPatch[];
  current: PodPatch[];
  history: PodPatch[];
}

function observedTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** A recovered experiment identifies its victim, not the UID of a replacement. */
export function buildTapestry(targets: Targets | null, experiments: readonly Experiment[], historyLimit = 3): Tapestry {
  const current: PodPatch[] = (targets?.items ?? []).map((pod: Target) => ({
    uid: pod.uid, name: pod.name, namespace: pod.namespace,
    kind: "current", state: pod.ready ? "ready" : "unready", ready: pod.ready,
    recoveryRecorded: false,
  }));
  const snapshotAt = observedTime(targets?.updatedAt);
  if (snapshotAt === null) return { nodes: current, current, history: [] };
  const present = new Set(current.map((patch) => patch.uid));
  const seen = new Set<string>();
  const history: PodPatch[] = [];
  const candidates = experiments.filter((item) => {
    const status = item.status.toLowerCase();
    const began = observedTime(item.startedAt ?? item.createdAt);
    return !item.dryRun && (status === "deleted" || status === "recovered")
      && !present.has(item.target.uid) && began !== null && began <= snapshotAt;
  }).sort((left, right) => (observedTime(right.completedAt ?? right.startedAt ?? right.createdAt) ?? 0)
    - (observedTime(left.completedAt ?? left.startedAt ?? left.createdAt) ?? 0));
  for (const item of candidates) {
    if (seen.has(item.target.uid) || history.length >= Math.max(0, historyLimit)) continue;
    seen.add(item.target.uid);
    const recoveryRecorded = item.status.toLowerCase() === "recovered"
      && typeof item.recoveryMs === "number" && Number.isFinite(item.recoveryMs) && item.recoveryMs >= 0;
    history.push({
      uid: item.target.uid, name: item.target.name, namespace: item.target.namespace,
      kind: "history", state: "deleted", ready: null, experimentId: item.id,
      recoveryRecorded, ...(recoveryRecorded ? { recoveryMs: item.recoveryMs! } : {}),
    });
  }
  // No name-prefix matching, inferred hosts, or edges to a supposed replacement.
  return { nodes: [...current, ...history], current, history };
}
