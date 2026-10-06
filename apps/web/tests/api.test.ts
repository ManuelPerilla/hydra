import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchEvents, fetchSnapshot, hasActiveExperiment, submitExperiment, type Experiment } from "../src/lib/api";

const experiment: Experiment = { id: "job-1", status: "queued", dryRun: true, target: { namespace: "chaos-demo", name: "demo-a", uid: "uid-a" }, createdAt: "2026-10-04T20:00:00Z" };
afterEach(() => vi.unstubAllGlobals());
describe("API trust boundary", () => {
  it("does not request protected resources before sign-in", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ authenticated: false, operator: false, user: null, csrfToken: "csrf", mode: "github" }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchSnapshot()).toEqual({ session: { authenticated: false, operator: false, user: null, csrfToken: "csrf", mode: "github" }, targets: null, experiments: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid authorization types instead of treating them as truthy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ authenticated: "false", operator: "true", user: "someone", csrfToken: "csrf", mode: "github" })));
    await expect(fetchSnapshot()).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("preserves CSRF and the same idempotency key across retries", async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json(experiment, { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const command = { namespace: "chaos-demo", podName: "demo-a", podUid: "uid-a", dryRun: true };
    await submitExperiment(command, "csrf-value", "unique-request");
    await submitExperiment(command, "csrf-value", "unique-request");
    for (const [path, init] of fetch.mock.calls) {
      expect(path).toBe("/api/experiments");
      expect(init.headers).toEqual({ "Content-Type": "application/json", "X-CSRF-Token": "csrf-value", "Idempotency-Key": "unique-request" });
      expect(JSON.parse(init.body)).toEqual(command);
      expect(init.credentials).toBe("same-origin");
    }
  });
  it("surfaces authorization errors and rejects malformed event cursors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(submitExperiment({ namespace: "chaos-demo", podName: "pod", podUid: "uid", dryRun: false }, "csrf", "key")).rejects.toEqual(new ApiError(403, "http_403"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [], lastSequence: "12", resetRequired: false })));
    await expect(fetchEvents(0)).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("blocks a second experiment while deletion awaits recovery", () => {
    expect(hasActiveExperiment([{ ...experiment, status: "deleted" }])).toBe(true);
    expect(hasActiveExperiment([{ ...experiment, status: "recovered" }])).toBe(false);
  });
});
