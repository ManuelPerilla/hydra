"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { languageNames, locales, messages, plural, type Locale, type Messages } from "@/i18n/messages";
import { ApiError, errorKey, fetchSnapshot, hasActiveExperiment, logout, submitExperiment, type Command, type Experiment, type HydraEvent, type Snapshot } from "@/lib/api";
import { startTelemetry, type TransportState } from "@/lib/telemetry";
import NodeTapestry from "@/components/node-tapestry";

function Icon({ name, size = 20 }: { name: "arrow" | "shield" | "pulse" | "github" | "chevron" | "bolt" | "refresh" | "nodes" | "check"; size?: number }) {
  const paths = {
    arrow: <><path d="M4 12h15M13 5l7 7-7 7" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    pulse: <><path d="M2 12h5l3-8 4 16 3-8h5" /></>,
    github: <><path d="M9 21c-4 1-4-2-6-2m12 2v-4c0-1-.3-1.7-.8-2.2 3-.3 5.8-1.4 5.8-6.1 0-1.3-.4-2.4-1.2-3.2.1-.3.5-1.6-.1-3.1 0 0-1-.3-3.3 1.2a11.3 11.3 0 0 0-6 0C7 2.1 6 2.4 6 2.4c-.6 1.5-.2 2.8-.1 3.1-.8.8-1.2 1.9-1.2 3.2 0 4.7 2.8 5.8 5.8 6.1-.5.5-.8 1.2-.8 2.2v4" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
    bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3" /></>,
    nodes: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="M10 6h7v8M6 10v7h8" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Mark({ large = false }: { large?: boolean }) {
  return <svg className={large ? "hydra-sculpture" : "brand-mark"} viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M13 61V34l13-12 14 12 14-12 13 12v27M13 44h54M40 34v27" stroke="currentColor" strokeWidth={large ? 2.4 : 3} strokeDasharray={large ? "2.6 2.3" : undefined} strokeLinecap="round" strokeLinejoin="round" /><path d="m21 15 5 7 5-7m18 0 5 7 5-7" stroke="currentColor" strokeWidth={large ? 2.4 : 3} strokeDasharray={large ? "2.6 2.3" : undefined} strokeLinecap="round" /></svg>;
}
function statusLabel(status: string, t: Messages): string {
  const names: Record<string, keyof Messages> = { queued: "statusQueued", running: "statusRunning", claimed: "statusRunning", deleting: "statusRunning", deleted: "statusRunning", recovering: "statusRunning", recovered: "statusRecovered", succeeded: "statusCompleted", completed: "statusCompleted", simulated: "simulated", failed: "statusFailed", rejected: "statusRejected" };
  return names[status.toLowerCase()] ? t[names[status.toLowerCase()]] : `${t.statusUnknown}: ${status}`;
}
function date(value: string, locale: Locale, short = false): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, short ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(parsed);
}
function Recovery({ item, locale }: { item: Experiment; locale: Locale }) {
  return <b className="recovery-value">{item.dryRun || item.recoveryMs == null ? "—" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(item.recoveryMs / 1000)} s`}</b>;
}

export default function Dashboard({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [transport, setTransport] = useState<TransportState>("connecting");
  const [events, setEvents] = useState<HydraEvent[]>([]);
  const [selectedUid, setSelectedUid] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<keyof Messages | null>(null);
  const [notice, setNotice] = useState<keyof Messages | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: string; command: Command } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [lastFresh, setLastFresh] = useState(0);
  const [now, setNow] = useState(0);
  const [activeSection, setActiveSection] = useState("console");
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLButtonElement>(null);
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);

  useEffect(() => {
    const followHash = () => {
      const section = window.location.hash.slice(1);
      setActiveSection(["console", "history", "architecture"].includes(section) ? section : "console");
    };
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, []);

  useEffect(() => {
    let active = true;
    let querying = false;
    const abort = new AbortController();
    async function load() {
      if (querying || !active) return;
      querying = true;
      try {
        const next = await fetchSnapshot(abort.signal);
        if (!active) return;
        setSnapshot(next); setApiAvailable(true); setLastFresh(Date.now()); setNow(Date.now());
        setSelectedUid((previous) => next.targets?.items.some((item) => item.uid === previous) ? previous : "");
      } catch (cause) {
        if (!active) return;
        setApiAvailable(false);
        if (cause instanceof ApiError && cause.status === 401) { setSnapshot(null); setError("unauthorized"); }
      } finally { querying = false; if (active) setLoading(false); }
    }
    void load();
    const interval = setInterval(() => { setNow(Date.now()); if (document.visibilityState === "visible") void load(); }, 10_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; abort.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [refreshVersion]);

  const authorized = snapshot?.session.authenticated ?? false;
  useEffect(() => {
    if (!authorized) { setTransport("offline"); return; }
    return startTelemetry({ onState: setTransport, onEvents: (batch, reset) => {
      if (batch.length === 0 && !reset) return;
      if (reset) setNotice("eventGap");
      setEvents((previous) => {
        const collected = new Map((reset ? [] : previous).map((event) => [event.sequence, event]));
        batch.forEach((event) => collected.set(event.sequence, event));
        return [...collected.values()].sort((a, b) => b.sequence - a.sequence).slice(0, 30);
      });
      refresh();
    } });
  }, [authorized, refresh]);

  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);

  const target = snapshot?.targets?.items.find((item) => item.uid === selectedUid && item.ready);
  const fresh = apiAvailable && lastFresh > 0 && now - lastFresh < 25_000;
  const heartbeatAt = snapshot?.targets?.updatedAt ? Date.parse(snapshot.targets.updatedAt) : 0;
  const clusterFresh = heartbeatAt > 0 && now - heartbeatAt < 30_000;
  const budgetReady = Boolean(snapshot?.targets && snapshot.targets.ready >= 2 && snapshot.targets.ready === snapshot.targets.total);
  const activeExperiment = hasActiveExperiment(snapshot?.experiments ?? []);
  const canSubmit = fresh && authorized && snapshot?.session.operator && Boolean(snapshot.session.csrfToken) && !submitting && (Boolean(draft) || (clusterFresh && budgetReady && Boolean(target) && !activeExperiment));
  useEffect(() => { if (!canSubmit && !submitting) setConfirming(false); }, [canSubmit, submitting]);
  const visibleState: TransportState = !fresh ? (loading ? "connecting" : "offline") : transport;
  const stateText: Record<TransportState, string> = { connecting: t.loading, live: t.live, polling: t.polling, reconnecting: t.reconnecting, offline: t.offline };
  const submitted = snapshot?.experiments.find((item) => item.id === submittedId);
  const completedNotice: keyof Messages | null = submitted?.status.toLowerCase() === "recovered"
    ? submitted.dryRun ? "dryRunCompleted" : "experimentRecovered"
    : submitted && ["failed", "rejected"].includes(submitted.status.toLowerCase()) ? "experimentFailed" : null;
  const visibleNotice = notice === "queued" ? completedNotice ?? notice : notice;
  const informativeNotice = visibleNotice === "queued" || visibleNotice === "uncertain" || visibleNotice === "eventGap";

  async function runExperiment() {
    if (!canSubmit || (!target && !draft) || !snapshot || inFlight.current) return;
    inFlight.current = true; setSubmitting(true); setConfirming(false); setError(null); setNotice(null);
    const attempt = draft ?? { key: crypto.randomUUID(), command: { namespace: target!.namespace, podName: target!.name, podUid: target!.uid, dryRun } };
    setDraft(attempt);
    try {
      const result = await submitExperiment(attempt.command, snapshot.session.csrfToken, attempt.key);
      setSubmittedId(result.id);
      setSnapshot((previous) => previous ? { ...previous, experiments: [result, ...previous.experiments.filter((item) => item.id !== result.id)] } : previous);
      setDraft(null); setNotice("queued"); refresh();
    } catch (cause) {
      setError(errorKey(cause));
      if (cause instanceof ApiError && cause.status > 0 && cause.status < 500 && cause.code !== "invalid_response") setDraft(null);
      else setNotice("uncertain");
    } finally { inFlight.current = false; setSubmitting(false); }
  }
  async function signOut() {
    if (!snapshot || inFlight.current) return;
    try { await logout(snapshot.session.csrfToken); setSnapshot(null); setEvents([]); refresh(); }
    catch (cause) { setError(errorKey(cause)); }
  }
  async function copyDraft(item: Experiment) {
    if (!item.tweetDraft) return;
    try { await navigator.clipboard.writeText(item.tweetDraft); setCopied(item.id); }
    catch { setError("copyError"); }
  }

  return <>
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href={`/${locale}`} aria-label="Hydra"><Mark /><span>hydra<span className="brand-period">.</span></span><span className="version">v0.1</span></a>
        <nav className="main-nav" aria-label={t.console}>{[["console", t.console], ["history", t.history], ["architecture", t.architecture]].map(([section, label]) => <a key={section} href={`#${section}`} className={activeSection === section ? "nav-active" : ""} aria-current={activeSection === section ? "location" : undefined} onClick={() => setActiveSection(section)}>{label}</a>)}</nav>
        <div className="header-actions">
          <label className="language-picker"><span className="sr-only">{t.language}</span><select value={locale} onChange={(event) => router.push(`/${event.target.value}`)}>{locales.map((value) => <option key={value} value={value}>{languageNames[value]}</option>)}</select><Icon name="chevron" size={12} /></label>
          {authorized ? <div className="session"><span><span className="session-name">{snapshot?.session.user ?? t.local}</span><small>{snapshot?.session.operator ? t.operator : t.reader}</small></span>{snapshot?.session.mode.toLowerCase() !== "local" && <button className="quiet-button" onClick={() => void signOut()}>{t.signOut}</button>}</div> : <a className="sign-in" href="/auth/github"><Icon name="github" size={17} /><span>{t.signIn}</span></a>}
        </div>
      </div>
    </header>
    <main id="main" className="page-shell">
      <section className="hero">
        <div className="hero-text"><p className="eyebrow"><span className="line" />{t.eyebrow}</p><h1>{t.title}<br /><span>{t.titleAccent}</span></h1><p className="hero-description">{t.subtitle}</p><div className="hero-tags"><span><Icon name="shield" size={14} />{t.safety}</span><span className="architecture-tag">amd64 / arm64</span></div></div>
        <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-grid" /><Mark large /><span className="art-coordinates">K8S / RECOVERY SYSTEM</span><span className="art-marker">H—01</span></div>
      </section>

      <div className="console-heading" id="console"><h2>{t.console}</h2><div className={`connection-badge connection-${visibleState}`} role="status"><span />{fresh && !authorized ? t.signIn : stateText[visibleState]}</div></div>
      {!fresh && <div className="connection-notice" role="status"><div className="notice-icon"><Icon name="pulse" /></div><div><strong>{snapshot ? t.stale : t.offlineTitle}</strong><p>{snapshot ? t.retryError : t.offlineBody}</p></div><button className="secondary-button" onClick={refresh} disabled={loading}><Icon name="refresh" size={15} />{t.retry}</button></div>}
      {fresh && authorized && snapshot?.targets && !clusterFresh && <div className="connection-notice" role="status"><div className="notice-icon"><Icon name="pulse" /></div><div><strong>{t.stale}</strong><p>{t.targetHint}</p></div><button className="secondary-button" onClick={refresh}><Icon name="refresh" size={15} />{t.retry}</button></div>}
      {fresh && !authorized && <div className="connection-notice" role="status"><div className="notice-icon"><Icon name="shield" /></div><div><strong>{t.signInHint}</strong></div></div>}
      {error && <div className="error-notice" role="alert"><strong>{t.errorTitle}</strong><p>{t[error]}</p><button className="quiet-button" onClick={() => setError(null)} aria-label={t.cancel}>×</button></div>}
      {visibleNotice && <div className={visibleNotice === "experimentFailed" ? "error-notice result-notice" : informativeNotice ? "connection-notice result-notice" : "success-notice"} role={visibleNotice === "experimentFailed" ? "alert" : "status"}><Icon name={visibleNotice === "experimentFailed" ? "bolt" : informativeNotice ? "refresh" : "check"} size={17} />{t[visibleNotice]}</div>}

      <section className="stats-grid" aria-label={t.console}>
        <div className="stat"><span className="stat-label">{t.scope}<Icon name="shield" size={16} /></span><strong className="mono">{snapshot?.targets?.namespace ?? "—"}</strong><small>{snapshot ? t.scopeHint : t.noData}</small></div>
        <div className="stat"><span className="stat-label">{t.replicas}<Icon name="nodes" size={16} /></span><strong>{snapshot?.targets ? <>{new Intl.NumberFormat(locale).format(snapshot.targets!.ready)}<span className="stat-total"> / {new Intl.NumberFormat(locale).format(snapshot.targets!.total)}</span></> : "—"}</strong><small>{snapshot ? t.replicaHint : t.noData}</small></div>
        <div className="stat"><span className="stat-label">{t.transport}<Icon name="pulse" size={16} /></span><strong className="transport-value">{stateText[visibleState]}</strong><small>{visibleState === "live" ? t.websocket : visibleState === "polling" ? t.pollingHint : t.offlineHint}</small></div>
      </section>

      <NodeTapestry targets={snapshot?.targets ?? null} experiments={snapshot?.experiments ?? []} selectedUid={selectedUid} onSelect={(uid) => { setSelectedUid(uid); setNotice(null); }} locale={locale} interactive={fresh && clusterFresh && !submitting && !draft} fresh={fresh && clusterFresh} />

      <div className="workspace-grid">
        <section className="experiment-panel panel" aria-labelledby="experiment-title">
          <p className="section-kicker">{t.experimentKicker}</p><h2 id="experiment-title">{t.experimentTitle}</h2><p className="section-description">{t.experimentBody}</p>
          <div className="form-body">
            <label className="field-label" htmlFor="target">{t.target}<span className="field-marker">KUBERNETES POD</span></label>
            <div className="target-select"><select id="target" value={selectedUid} onChange={(event) => { setSelectedUid(event.target.value); setNotice(null); }} disabled={!fresh || !clusterFresh || submitting || Boolean(draft)}><option value="">{snapshot?.targets?.items.length ? t.chooseTarget : t.noTargets}</option>{snapshot?.targets?.items.map((item) => <option key={item.uid} value={item.uid} disabled={!item.ready}>{item.name}{item.ready ? " ●" : " ○"}</option>)}</select><Icon name="chevron" size={15} /></div>
            <p className="field-help">{t.targetHint}</p>
            {target && <dl className="target-details"><div><dt>namespace</dt><dd><bdi>{target.namespace}</bdi></dd></div><div><dt>UID</dt><dd title={target.uid}><bdi>{target.uid}</bdi></dd></div></dl>}
            <fieldset className="mode-fieldset" disabled={submitting || Boolean(draft)}><legend>{t.mode}</legend><label className={`mode-option ${dryRun ? "mode-selected" : ""}`}><input type="radio" name="mode" checked={dryRun} onChange={() => { setDryRun(true); setNotice(null); }} /><span><strong>{t.dryRun}<span className="safe-dot" /></strong><small>{t.dryRunHint}</small></span></label><label className={`mode-option destructive-option ${!dryRun ? "mode-selected" : ""}`}><input type="radio" name="mode" checked={!dryRun} onChange={() => { setDryRun(false); setNotice(null); }} /><span><strong>{t.destructive}<Icon name="bolt" size={14} /></strong><small>{t.destructiveHint}</small></span></label></fieldset>
            {draft && <button className="quiet-button discard-button" onClick={() => { setDraft(null); setNotice(null); }} disabled={submitting}>{t.resetDraft}</button>}
            <button ref={restoreFocus} className={`inject-button ${dryRun ? "dry-button" : ""}`} disabled={!canSubmit} onClick={() => dryRun ? void runExperiment() : setConfirming(true)}><Icon name={dryRun ? "shield" : "bolt"} size={19} /><span>{submitting ? t.submitting : dryRun ? t.simulate : t.inject}</span><Icon name="arrow" size={18} /></button>
            <p className="execution-note">{activeExperiment ? t.pending : !authorized ? t.signInHint : !snapshot?.session.operator ? t.observerHint : !budgetReady || !clusterFresh ? t.budgetUnavailable : snapshot?.session.mode.toLowerCase() === "local" ? t.localHint : t.safety}</p>
          </div>
        </section>

        <section className="history-panel panel" id="history" aria-labelledby="history-title"><div className="history-header"><p className="section-kicker">{t.activityKicker}</p><div className="history-title-row"><h2 id="history-title">{t.activityTitle}</h2><span className="count-badge">{new Intl.NumberFormat(locale).format(snapshot?.experiments.length ?? 0)}</span></div><p className="section-description">{t.activityBody}</p></div>
          {!snapshot?.experiments.length ? <div className="empty-state"><div className="empty-visual"><Icon name="pulse" size={40} /><span className="empty-cross cross-one" /><span className="empty-cross cross-two" /></div><h3>{t.emptyTitle}</h3><p>{t.emptyBody}</p><span className="empty-rule" /></div> : <div className="experiment-list">{snapshot.experiments.slice(0, 12).map((item) => <article className="experiment-row" key={item.id}><div className="experiment-row-top"><span className={`result-badge result-${item.status.toLowerCase()}`}>{statusLabel(item.status, t)}</span>{item.dryRun && <span className="dry-run-tag">{t.simulated}</span>}<time dateTime={item.createdAt}>{date(item.createdAt, locale)}</time></div><div className="experiment-row-main"><div><strong className="pod-name"><bdi>{item.target.name}</bdi></strong><small className="experiment-id">{t.experiment} <bdi>{item.id.slice(0, 8)}</bdi></small></div><div className="recovery"><small>{t.recovery}</small><Recovery item={item} locale={locale} /></div></div>{item.message && <p className="experiment-message">{item.message}</p>}{item.tweetDraft && <details className="tweet-draft"><summary>{t.tweet}</summary><p dir="auto">{item.tweetDraft}</p><button className="quiet-button" onClick={() => void copyDraft(item)}>{copied === item.id ? t.copied : t.copy}</button></details>}</article>)}</div>}
          <div className="event-panel"><div className="event-heading"><h3>{t.timeline}</h3><span>{plural(locale, events.length, t.eventOne, t.eventOther, { zero: t.eventZero, two: t.eventTwo, few: t.eventFew, many: t.eventMany })}</span></div>{!events.length ? <p className="event-empty">{t.emptyEvents}</p> : <ol className="event-list">{events.slice(0, 10).map((event) => <li key={event.sequence}><span className="event-dot" /><time dateTime={event.at}>{date(event.at, locale, true)}</time><div><bdi>{event.type}</bdi><small><bdi>{event.experimentId?.slice(0, 8) ?? "—"}</bdi></small></div></li>)}</ol>}</div>
        </section>
      </div>
      {snapshot?.targets?.updatedAt && <p className="updated-at"><span className="safe-dot" />{t.lastUpdate}: <time dateTime={snapshot.targets.updatedAt}>{date(snapshot.targets.updatedAt, locale, true)}</time></p>}

      <section className="architecture-section" id="architecture" aria-labelledby="architecture-title"><div className="architecture-heading"><div><p className="section-kicker">{t.architectureKicker}</p><h2 id="architecture-title">{t.architectureTitle}</h2><p className="section-description">{t.architectureBody}</p></div><div className="cost-label"><span>$</span>0<small>/ HOSTING</small></div></div><div className="architecture-cards"><article><span className="card-number">01</span><Icon name="shield" size={24} /><h3>{t.controlPlane}</h3><p>{t.controlDesc}</p><span className="mono card-foot">hydra-system</span></article><article><span className="card-number">02</span><Icon name="nodes" size={24} /><h3>{t.demo}</h3><p>{t.demoDesc}</p><span className="mono card-foot">chaos-demo</span></article><article><span className="card-number">03</span><Icon name="pulse" size={24} /><h3>{t.resources}</h3><p>{t.resourceDesc}</p><span className="card-foot">{t.resourceNote}</span></article></div><div className="hosting-options"><div><span className="hosting-label">LOCAL</span><h3>{t.home}</h3><p>{t.homeDesc}</p></div><div><span className="hosting-label">ARM / CLOUD</span><h3>{t.oracle}</h3><p>{t.oracleDesc}</p></div></div><p className="cost-note">{t.costNote}</p></section>
    </main>
    <footer className="site-footer"><div className="footer-inner"><div className="footer-brand"><Mark /><span>hydra.</span></div><p>{t.footer}</p><span>{t.openSource}</span></div></footer>

    <dialog ref={dialog} className="confirm-dialog" onCancel={() => { setConfirming(false); restoreFocus.current?.focus(); }} onClose={() => setConfirming(false)} aria-labelledby="confirm-title" aria-describedby="confirm-description"><div className="dialog-symbol"><Icon name="bolt" size={28} /></div><p className="section-kicker">{t.experimentKicker}</p><h2 id="confirm-title">{t.confirmTitle}</h2><p id="confirm-description">{t.confirmBody}</p><div className="confirm-target"><span>{draft?.command.namespace ?? target?.namespace}</span><strong><bdi>{draft?.command.podName ?? target?.name}</bdi></strong></div><div className="dialog-actions"><button autoFocus className="secondary-button" onClick={() => { setConfirming(false); restoreFocus.current?.focus(); }}>{t.cancel}</button><button className="confirm-delete" disabled={!canSubmit} onClick={() => void runExperiment()}><Icon name="bolt" size={17} />{t.confirm}</button></div></dialog>
  </>;
}
