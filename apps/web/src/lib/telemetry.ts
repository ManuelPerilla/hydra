import { HubConnectionBuilder, HttpTransportType, LogLevel } from "@microsoft/signalr";
import { fetchEvents, isEvent, type EventBatch, type HydraEvent } from "./api";

export type TransportState = "connecting" | "live" | "polling" | "reconnecting" | "offline";
export interface Hub {
  on(method: string, callback: (event: unknown) => void): void;
  onreconnecting(callback: () => void): void;
  onreconnected(callback: () => void): void;
  onclose(callback: () => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
export function createHub(): Hub {
  return new HubConnectionBuilder()
    .withUrl("/hubs/telemetry", { transport: HttpTransportType.WebSockets, skipNegotiation: true, withCredentials: true })
    .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
    .configureLogging(LogLevel.None).build();
}

/** Cursor advances only on replay batches. WebSocket gaps cannot skip persisted events. */
export class EventCursor {
  after = 0;
  private seen = new Set<number>();
  accept(event: HydraEvent): boolean {
    if (!isEvent(event) || this.seen.has(event.sequence)) return false;
    this.seen.add(event.sequence);
    if (this.seen.size > 2_000) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  batch(batch: EventBatch): HydraEvent[] {
    if (batch.resetRequired) { this.after = 0; this.seen.clear(); }
    const events = [...batch.items].sort((a, b) => a.sequence - b.sequence).filter((event) => this.accept(event));
    // lastSequence is the server's persisted upper watermark. Empty pages can also advance it.
    this.after = Math.max(this.after, batch.lastSequence);
    return events;
  }
}

export function startTelemetry(options: {
  onEvents: (events: HydraEvent[], reset: boolean) => void;
  onState: (state: TransportState) => void;
  hub?: Hub;
  read?: (after: number, signal: AbortSignal) => Promise<EventBatch>;
  pollMs?: number;
}): () => void {
  const hub = options.hub ?? createHub();
  const read = options.read ?? fetchEvents;
  const cursor = new EventCursor();
  const abort = new AbortController();
  let stopped = false;
  let connected = false;
  let polling = false;
  let replayAgain = false;
  let starting = false;
  let retryCount = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const emitState = (state: TransportState) => { if (!stopped) options.onState(state); };
  async function replay() {
    if (stopped) return;
    if (polling) { replayAgain = true; return; }
    polling = true;
    try {
      const batch = await read(cursor.after, abort.signal);
      if (!stopped) {
        options.onEvents(cursor.batch(batch), batch.resetRequired);
        if (!connected) emitState("polling");
      }
    } catch { if (!connected) emitState("offline"); }
    finally {
      polling = false;
      if (replayAgain && !stopped) { replayAgain = false; void replay(); }
    }
  }
  function scheduleStart() {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(retryCount++, 5));
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void start(); }, delay);
  }
  async function start() {
    if (stopped || starting) return;
    starting = true;
    try {
      await hub.start();
      if (stopped) { await hub.stop(); return; }
      connected = true; retryCount = 0; emitState("live"); void replay();
    } catch { connected = false; void replay(); scheduleStart(); }
    finally { starting = false; }
  }
  hub.on("Event", (event) => {
    if (stopped || !isEvent(event)) return;
    if (cursor.accept(event)) options.onEvents([event], false);
    // Replay catches dropped and out-of-order events and sets the durable cursor.
    if (event.sequence > cursor.after + 1) void replay();
  });
  hub.onreconnecting(() => { connected = false; emitState("reconnecting"); void replay(); });
  hub.onreconnected(() => { connected = true; emitState("live"); void replay(); });
  hub.onclose(() => { connected = false; if (!stopped) { void replay(); scheduleStart(); } });
  emitState("connecting");
  void replay(); void start();
  const interval = setInterval(() => { if (!connected) void replay(); }, options.pollMs ?? 3_000);
  return () => {
    stopped = true; abort.abort(); clearInterval(interval);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    void hub.stop().catch(() => undefined);
  };
}
