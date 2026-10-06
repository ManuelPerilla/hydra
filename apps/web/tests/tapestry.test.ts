import { describe, expect, it } from "vitest";
import { buildTapestry } from "../src/lib/tapestry";
import type { Experiment, Target, Targets } from "../src/lib/api";

const pod = (uid: string, ready = true, name = `demo-${uid}`, namespace = "chaos-demo"): Target => ({ uid, ready, name, namespace });
const snapshot = (items: Target[]): Targets => ({ namespace: "chaos-demo", items, total: items.length, ready: items.filter((item) => item.ready).length, updatedAt: "2026-10-04T22:05:00Z" });
const experiment = (overrides: Partial<Experiment> = {}): Experiment => ({
  id: "experiment-1", status: "deleted", dryRun: false,
  target: { uid: "old", name: "demo-old", namespace: "chaos-demo" },
  createdAt: "2026-10-04T22:00:00Z", startedAt: "2026-10-04T22:00:01Z", ...overrides,
});

describe("observed pod tapestry", () => {
  it("never turns a dry run into a deleted-pod footprint", () => {
    const model = buildTapestry(snapshot([pod("new")]), [experiment({ dryRun: true, status: "recovered", recoveryMs: 100 })]);
    expect(model.history).toEqual([]);
    expect(model.nodes.map((patch) => patch.uid)).toEqual(["new"]);
  });

  it("shows confirmed deletion only when the original UID is absent", () => {
    expect(buildTapestry(snapshot([pod("old")]), [experiment()]).history).toEqual([]);
    const model = buildTapestry(snapshot([pod("new", true, "demo-old")]), [experiment()]);
    expect(model.history).toMatchObject([{ uid: "old", kind: "history", state: "deleted", ready: null }]);
    expect(model.current).toMatchObject([{ uid: "new", kind: "current", state: "ready" }]);
  });

  it("derives each readiness state from the real pod, never aggregate counts", () => {
    const targets = snapshot([pod("a", false), pod("b", true)]);
    targets.ready = 99;
    expect(buildTapestry(targets, []).current.map((patch) => patch.state)).toEqual(["unready", "ready"]);
  });

  it("does not attribute historical recovery to a different workload or revive the victim UID", () => {
    const model = buildTapestry(snapshot([pod("other", false, "other-service", "other-lab")]), [experiment({ status: "recovered", recoveryMs: 432 })]);
    expect(model.current[0]).toMatchObject({ uid: "other", state: "unready", recoveryRecorded: false });
    expect(model.current[0].experimentId).toBeUndefined();
    expect(model.history[0]).toMatchObject({ uid: "old", kind: "history", state: "deleted", ready: null, recoveryRecorded: true, recoveryMs: 432 });
  });

  it("requires a measured recovered experiment to record a recovery", () => {
    for (const recoveryMs of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(buildTapestry(snapshot([]), [experiment({ status: "recovered", recoveryMs })]).history[0].recoveryRecorded).toBe(false);
    }
    expect(buildTapestry(snapshot([]), [experiment({ status: "recovered", recoveryMs: 0 })]).history[0].recoveryRecorded).toBe(true);
  });

  it("does not infer disappearance from missing or earlier snapshots, or from failure alone", () => {
    expect(buildTapestry(null, [experiment()]).nodes).toEqual([]);
    expect(buildTapestry({ ...snapshot([]), updatedAt: null }, [experiment()]).history).toEqual([]);
    expect(buildTapestry({ ...snapshot([]), updatedAt: "2026-10-04T21:00:00Z" }, [experiment()]).history).toEqual([]);
    expect(buildTapestry(snapshot([]), [experiment({ status: "failed" })]).history).toEqual([]);
  });

  it("bounds history and deduplicates the same immutable victim UID", () => {
    const events = [experiment({ id: "first" }), experiment({ id: "latest", status: "recovered", recoveryMs: 12, completedAt: "2026-10-04T22:04:00Z" }),
      experiment({ id: "second", target: { uid: "second", name: "demo-second", namespace: "chaos-demo" } })];
    const model = buildTapestry(snapshot([]), events, 1);
    expect(model.history).toHaveLength(1);
    expect(model.history[0].experimentId).toBe("latest");
  });
});
