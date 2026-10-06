import { afterEach, describe, expect, it, vi } from "vitest";
import { EventCursor, startTelemetry, type Hub, type TransportState } from "../src/lib/telemetry";
import type { EventBatch, HydraEvent } from "../src/lib/api";

const event = (sequence: number): HydraEvent => ({ sequence, type: "experiment.recovered", experimentId: "job-1", at: "2026-10-04T20:00:00Z", data: {} });
const batch = (items: HydraEvent[], lastSequence: number, resetRequired = false): EventBatch => ({ items, lastSequence, resetRequired });
class TestHub implements Hub {
  receive: (value: unknown) => void = () => undefined;
  reconnecting: () => void = () => undefined;
  reconnected: () => void = () => undefined;
  closed: () => void = () => undefined;
  start = vi.fn(async () => undefined);
  stop = vi.fn(async () => undefined);
  on(_method: string, callback: (value: unknown) => void) { this.receive = callback; }
  onreconnecting(callback: () => void) { this.reconnecting = callback; }
  onreconnected(callback: () => void) { this.reconnected = callback; }
  onclose(callback: () => void) { this.closed = callback; }
}
afterEach(() => vi.useRealTimers());
describe("durable event recovery", () => {
  it("does not skip missing events when WebSocket delivery jumps ahead", () => {
    const cursor = new EventCursor();
    expect(cursor.batch(batch([event(1)], 1))).toEqual([event(1)]);
    expect(cursor.accept(event(4))).toBe(true);
    expect(cursor.after).toBe(1);
    expect(cursor.batch(batch([event(2), event(3), event(4)], 4))).toEqual([event(2), event(3)]);
    expect(cursor.after).toBe(4);
    expect(cursor.accept(event(4))).toBe(false);
  });
  it("resets the retained window at the server watermark after retention expires", () => {
    const cursor = new EventCursor();
    cursor.batch(batch([event(1)], 1));
    expect(cursor.batch(batch([], 100, true))).toEqual([]);
    expect(cursor.after).toBe(100);
    expect(cursor.batch(batch([event(101)], 101))).toEqual([event(101)]);
  });
  it("falls back to HTTP, retries initial connection, and cleans up after unmount", async () => {
    vi.useFakeTimers();
    const hub = new TestHub();
    hub.start.mockRejectedValueOnce(new Error("websocket unavailable"));
    const read = vi.fn(async () => batch([event(1)], 1));
    const states: TransportState[] = [];
    const received: HydraEvent[] = [];
    const stop = startTelemetry({ hub, read, onState: (state) => states.push(state), onEvents: (items) => received.push(...items), pollMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(states).toContain("polling");
    expect(received).toEqual([event(1)]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(hub.start).toHaveBeenCalledTimes(2);
    expect(states).toContain("live");
    stop();
    const requests = read.mock.calls.length;
    hub.receive(event(2)); hub.closed();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(requests);
    expect(received).toEqual([event(1)]);
    expect(hub.stop).toHaveBeenCalled();
  });
  it("replays retained events on reconnection", async () => {
    vi.useFakeTimers();
    const hub = new TestHub();
    let current: EventBatch = batch([event(1)], 1);
    const read = vi.fn(async () => current);
    const received: HydraEvent[] = [];
    const stop = startTelemetry({ hub, read, onState: () => undefined, onEvents: (items) => received.push(...items) });
    await vi.advanceTimersByTimeAsync(0);
    current = batch([event(2), event(3)], 3);
    hub.reconnecting(); hub.reconnected();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    expect(received.map((item) => item.sequence)).toEqual([1, 2, 3]);
    stop();
  });
});
