"use client";

import { useEffect, useReducer, useRef } from "react";
import type { Locale } from "@/i18n/messages";
import { learningMessages } from "@/i18n/learning";
import { initialLesson, lessonReducer } from "@/lib/learning";
import PodSimulator from "./pod-simulator";

export default function PodLesson({ locale }: { locale: Locale }) {
  const t = learningMessages[locale];
  const [state, dispatch] = useReducer(lessonReducer, initialLesson);
  const heading = useRef<HTMLHeadingElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const previousStep = useRef(state.step);
  useEffect(() => {
    if (previousStep.current !== state.step) heading.current?.focus();
    previousStep.current = state.step;
  }, [state.step]);
  useEffect(() => {
    if (state.step === 2 && state.stage === 3) continueButton.current?.focus();
  }, [state.step, state.stage]);
  return <>
    <section className="learning-intro"><p className="eyebrow">{t.homeTitle}</p><h1>{t.lessonTitle}</h1><p>{t.lessonIntro}</p></section>
    <aside className="simulation-notice"><span className="simulation-badge">{t.simulationBadge}</span><p>{t.simulationNotice}</p></aside>
    <ol className="lesson-progress">{t.steps.map((label, index) => <li key={label} aria-current={index === state.step ? "step" : undefined}><span aria-hidden="true">{index + 1}</span>{label}</li>)}</ol>
    <section className="lesson-card" aria-labelledby="lesson-step-title">
      <h2 id="lesson-step-title" tabIndex={-1} ref={heading}>{t.steps[state.step]}</h2>
      {state.step === 0 && <><p className="lesson-lead">{t.homeIntro}</p><div className="lesson-concepts">{t.concepts.map((concept) => <article key={concept.title}><h3>{concept.title}</h3><p>{concept.body}</p></article>)}</div><PodSimulator stage={0} t={t} /></>}
      {state.step === 1 && <fieldset className="lesson-predictions"><legend>{t.predictionQuestion}</legend><p>{t.predictionHint}</p>{t.predictions.map((prediction, index) => <label key={prediction}><input type="radio" name="prediction" checked={state.prediction === index} onChange={() => dispatch({ type: "predict", choice: index })} /><span>{prediction}</span></label>)}</fieldset>}
      {state.step === 2 && <><PodSimulator stage={state.stage} t={t} />{state.stage < 3 && <button className="lesson-button lesson-experiment-button" onClick={() => dispatch({ type: "advance" })}>{state.stage === 0 ? t.removeLabel : t.advanceLabel}</button>}</>}
      {state.step === 3 && <div className="lesson-debrief"><h3>{t.debriefTitle}</h3><p className="lesson-feedback">{state.prediction === 1 ? t.correctFeedback : t.incorrectFeedback}</p><p>{t.debriefBody}</p><p className="lesson-caveat">{t.caveat}</p><button className="lesson-button" onClick={() => dispatch({ type: "reset" })}>{t.retryLabel}</button></div>}
      <div className="lesson-controls">{state.step > 0 && <button className="lesson-button lesson-secondary" onClick={() => dispatch({ type: "back" })}>{t.backLabel}</button>}{state.step < 3 && <button ref={continueButton} className="lesson-button" disabled={(state.step === 1 && state.prediction === null) || (state.step === 2 && state.stage < 3)} onClick={() => dispatch({ type: "next" })}>{t.continueLabel}</button>}{state.step > 0 && <button className="lesson-reset" onClick={() => dispatch({ type: "reset" })}>{t.resetLabel}</button>}</div>
    </section>
    <aside className="learning-next"><div><h2>{t.nextTitle}</h2><p>{t.nextBody}</p></div><a className="lesson-button lesson-secondary" href={`/${locale}`}>{t.consoleLabel}</a></aside>
  </>;
}
