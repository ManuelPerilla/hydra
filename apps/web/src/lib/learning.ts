/** A local teaching model, deliberately independent of the API and telemetry. */
export type LessonState = { step: 0 | 1 | 2 | 3; prediction: number | null; stage: 0 | 1 | 2 | 3 };
export type LessonAction = { type: "predict"; choice: number } | { type: "next" | "back" | "advance" | "reset" };
export const initialLesson: LessonState = { step: 0, prediction: null, stage: 0 };
export function lessonReducer(state: LessonState, action: LessonAction): LessonState {
  switch (action.type) {
    case "reset": return initialLesson;
    case "predict": return state.step === 1 && [0, 1, 2].includes(action.choice) ? { ...state, prediction: action.choice } : state;
    case "next":
      if (state.step === 0) return { ...state, step: 1 };
      if (state.step === 1 && state.prediction !== null) return { ...state, step: 2, stage: 0 };
      if (state.step === 2 && state.stage === 3) return { ...state, step: 3 };
      return state;
    case "back": return state.step > 0 ? { ...state, step: (state.step - 1) as LessonState["step"], stage: 0 } : state;
    case "advance": return state.step === 2 && state.stage < 3 ? { ...state, stage: (state.stage + 1) as LessonState["stage"] } : state;
  }
}
export function simulatedPods(stage: LessonState["stage"]) {
  return [
    { id: stage < 2 ? "A" : "C", status: stage === 1 ? "missing" : stage === 2 ? "starting" : "ready" },
    { id: "B", status: "ready" },
  ] as const;
}
