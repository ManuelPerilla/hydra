"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Experiment, Targets } from "@/lib/api";
import { buildTapestry, type PodPatch } from "@/lib/tapestry";
import { messages, type Locale } from "@/i18n/messages";

export interface NodeTapestryProps {
  targets: Targets | null;
  experiments: Experiment[];
  selectedUid: string;
  onSelect: (uid: string) => void;
  locale: Locale;
  interactive: boolean;
  fresh: boolean;
}

function PatchIcon({ patch, arriving }: { patch: PodPatch; arriving: boolean }) {
  const historical = patch.kind === "history";
  return <svg className="tapestry-server-icon" width="72" height="62" viewBox="0 0 72 62" fill="none" aria-hidden="true">
    <rect x="10" y="7" width="52" height="20" rx="5" stroke="currentColor" strokeWidth="1.7" strokeDasharray={historical ? "3 4" : undefined} />
    <rect x="10" y="34" width="52" height="20" rx="5" stroke="currentColor" strokeWidth="1.7" strokeDasharray={historical ? "3 4" : undefined} />
    <path d="M21 17h17M21 44h17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="50" cy="17" r="2.2" fill={historical ? "none" : "currentColor"} stroke={historical ? "currentColor" : undefined} />
    <circle cx="50" cy="44" r="2.2" fill={historical ? "none" : "currentColor"} stroke={historical ? "currentColor" : undefined} />
    {historical && <path d="m55 25 6 5-5 6m-45-9-5 4 5 5M34 25l-4 6 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 3" />}
    {(arriving || patch.recoveryRecorded) && <g className="tapestry-mend" strokeWidth="2" strokeLinecap="round">
      <path d="m23 26 4 9m5-9 4 9m5-9 4 9m5-9 4 9" stroke="currentColor" />
      <path d="M20 31h35" stroke="currentColor" strokeDasharray="2 3" />
    </g>}
  </svg>;
}

export default function NodeTapestry({ targets, experiments, selectedUid, onSelect, locale, interactive, fresh }: NodeTapestryProps) {
  const t = messages[locale];
  const id = useId();
  const model = useMemo(() => buildTapestry(targets, experiments), [targets, experiments]);
  const currentUidKey = JSON.stringify(model.current.map((patch) => patch.uid).sort());
  const hasSnapshot = targets !== null;
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const rebound = useRef<Animation | null>(null);
  const knownUids = useRef<Set<string> | null>(null);
  const arrivalTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const previousStates = useRef<Map<string, string> | null>(null);
  const [arriving, setArriving] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState(false);
  const pointer = useRef<{ id: number; x: number; y: number; left: number; top: number; active: boolean } | null>(null);

  useEffect(() => {
    if (!fresh || !hasSnapshot) {
      for (const timer of arrivalTimers.current.values()) clearTimeout(timer);
      arrivalTimers.current.clear();
      setArriving(new Set());
      return;
    }
    const next = new Set<string>(JSON.parse(currentUidKey));
    // The first snapshot is a baseline, rather than evidence of a repair.
    const added = knownUids.current === null ? new Set<string>()
      : new Set([...next].filter((uid) => !knownUids.current!.has(uid)));
    knownUids.current = next;
    for (const [uid, timer] of arrivalTimers.current) {
      if (!next.has(uid)) { clearTimeout(timer); arrivalTimers.current.delete(uid); }
    }
    setArriving((current) => new Set([...current].filter((uid) => next.has(uid)).concat([...added])));
    for (const uid of added) {
      arrivalTimers.current.set(uid, setTimeout(() => {
        arrivalTimers.current.delete(uid);
        setArriving((current) => { const remaining = new Set(current); remaining.delete(uid); return remaining; });
      }, 1_600));
    }
  }, [fresh, hasSnapshot, currentUidKey]);

  useEffect(() => () => {
    for (const timer of arrivalTimers.current.values()) clearTimeout(timer);
    rebound.current?.cancel();
  }, []);

  useEffect(() => {
    const states = new Map(model.nodes.map((patch) => [patch.uid, `${patch.kind}:${patch.state}:${patch.recoveryRecorded}`]));
    const changed = previousStates.current !== null && (previousStates.current.size !== states.size
      || [...states].some(([uid, value]) => previousStates.current?.get(uid) !== value));
    previousStates.current = states;
    if (changed && fresh) setAnnouncement(t.tapestryUpdated);
  }, [model.nodes, fresh, t.tapestryUpdated]);

  function startPan(event: PointerEvent<HTMLDivElement>) {
    // Preserve native touch scrolling and every card's button interaction.
    if (event.pointerType === "touch" || event.button !== 0 || (event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    rebound.current?.cancel();
    if (canvas.current) canvas.current.style.transform = "";
    const element = event.currentTarget;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, active: false };
  }
  function movePan(event: PointerEvent<HTMLDivElement>) {
    const gesture = pointer.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.active && Math.hypot(dx, dy) < 5) return;
    if (!gesture.active) {
      gesture.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    event.preventDefault();
    const wantedLeft = gesture.left - dx;
    const wantedTop = gesture.top - dy;
    event.currentTarget.scrollLeft = wantedLeft;
    event.currentTarget.scrollTop = wantedTop;
    if (canvas.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // The browser clamps both LTR and RTL scroll ranges; only the excess gets a soft pull.
      const pullX = Math.max(-18, Math.min(18, (event.currentTarget.scrollLeft - wantedLeft) * 0.16));
      const pullY = Math.max(-18, Math.min(18, (event.currentTarget.scrollTop - wantedTop) * 0.16));
      canvas.current.style.transform = `translate3d(${pullX}px, ${pullY}px, 0)`;
    }
  }
  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    setDragging(false);
    if (canvas.current) {
      const from = canvas.current.style.transform;
      canvas.current.style.transform = "";
      if (from && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        rebound.current = canvas.current.animate([{ transform: from }, { transform: "none" }], { duration: 350, easing: "cubic-bezier(.2,.7,.3,1)" });
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <section className="tapestry-panel" aria-labelledby={`${id}-title`} data-stale={!fresh}>
    <div className="tapestry-header">
      <div><span className="section-kicker">{t.tapestryKicker}</span><h2 id={`${id}-title`}>{t.tapestryTitle}</h2><p>{t.tapestryBody}</p></div>
      {!fresh && <span className="tapestry-last-known">{t.tapestryLastKnown}</span>}
    </div>
    <div className="tapestry-legend" aria-label={t.tapestryLegend}>
      <span className="tapestry-legend-item" data-state="ready">{t.tapestryReady}</span>
      <span className="tapestry-legend-item" data-state="unready">{t.tapestryUnready}</span>
      <span className="tapestry-legend-item" data-state="deleted">{t.tapestryHistory}</span>
    </div>
    {model.nodes.length > 0 ? <div className="tapestry-viewport" ref={viewport} role="region" tabIndex={0}
      aria-label={t.tapestryPan} aria-describedby={`${id}-caption`} data-dragging={dragging}
      onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}
      onPointerLeave={(event) => { if (!pointer.current?.active) endPan(event); }}>
      <div className="tapestry-canvas" ref={canvas}>
        <svg className="tapestry-stitch" viewBox="0 0 900 250" preserveAspectRatio="none" fill="none" aria-hidden="true">
          <path d="M35 130C165 30 250 215 390 125S615 40 865 125" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 7" vectorEffect="non-scaling-stroke" />
          <path d="M55 137C178 37 258 222 398 132S623 47 845 132" stroke="currentColor" strokeWidth=".7" strokeDasharray="2 10" vectorEffect="non-scaling-stroke" />
        </svg>
        {model.nodes.map((patch) => {
          const historical = patch.kind === "history";
          const state = historical ? t.tapestryDeleted : patch.ready ? t.tapestryReady : t.tapestryUnready;
          const contents = <>
            <span className="tapestry-node-kind">{historical ? t.tapestryHistory : t.tapestryCurrent}</span>
            <PatchIcon patch={patch} arriving={fresh && !historical && arriving.has(patch.uid)} />
            <span className="tapestry-node-name"><bdi>{patch.name}</bdi></span>
            <span className="tapestry-node-state">{state}</span>
            <small className="tapestry-node-namespace"><bdi>{patch.namespace}</bdi></small>
            {historical && <small className="tapestry-node-experiment">{t.experiment} <bdi title={patch.experimentId}>{patch.experimentId?.slice(0, 8)}</bdi></small>}
            {patch.recoveryRecorded && <span className="tapestry-recovery-note">{t.tapestryMended}</span>}
          </>;
          return <div key={patch.uid} className={`tapestry-node tapestry-node--${patch.state}`}
            data-kind={patch.kind} data-arriving={fresh && !historical && arriving.has(patch.uid)} data-selected={!historical && selectedUid === patch.uid} data-recovery-recorded={patch.recoveryRecorded}>
            {historical ? <div className="tapestry-node-button" role="group" aria-label={`${t.tapestryHistory}: ${patch.name}, ${state}`}>{contents}</div>
              : <button className="tapestry-node-button" type="button" disabled={!interactive || !fresh || !patch.ready}
                aria-pressed={selectedUid === patch.uid} aria-label={`${t.tapestrySelect.replace("{name}", patch.name)}, ${state}`}
                onClick={() => onSelect(patch.uid)}>{contents}</button>}
          </div>;
        })}
      </div>
    </div> : <div className="tapestry-empty"><svg width="54" height="54" viewBox="0 0 54 54" fill="none" aria-hidden="true"><circle cx="27" cy="27" r="21" stroke="currentColor" strokeDasharray="3 5" /><path d="M17 22h20v12H17z" stroke="currentColor" strokeDasharray="2 4" /></svg><p>{t.tapestryEmpty}</p></div>}
    <p className="tapestry-caption" id={`${id}-caption`}>{t.tapestryCaption}{model.history.some((patch) => patch.recoveryRecorded) && <> {t.tapestryRecoveryScope}</>}</p>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  </section>;
}
