import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initialLesson, lessonReducer, simulatedPods, type LessonState } from "../src/lib/learning";
import { learningMessages } from "../src/i18n/learning";
import { locales } from "../src/i18n/messages";

const experiment: LessonState = { step: 2, prediction: 1, stage: 0 };
describe("standalone pod lesson", () => {
  it("requires a prediction before entering the experiment", () => {
    const predict = lessonReducer(initialLesson, { type: "next" });
    expect(predict.step).toBe(1);
    expect(lessonReducer(predict, { type: "next" })).toEqual(predict);
    const answered = lessonReducer(predict, { type: "predict", choice: 0 });
    expect(lessonReducer(answered, { type: "next" })).toEqual({ ...experiment, prediction: 0 });
  });
  it("ignores invalid predictions and changes outside the prediction step", () => {
    expect(lessonReducer(initialLesson, { type: "predict", choice: 1 })).toEqual(initialLesson);
    expect(lessonReducer({ ...initialLesson, step: 1 }, { type: "predict", choice: 3 }).prediction).toBeNull();
  });
  it("runs only while on the experiment step and never advances past recovery", () => {
    expect(lessonReducer(initialLesson, { type: "advance" })).toEqual(initialLesson);
    let state = experiment;
    for (let i = 0; i < 20; i++) state = lessonReducer(state, { type: "advance" });
    expect(state.stage).toBe(3);
    expect(lessonReducer(state, { type: "next" }).step).toBe(3);
  });
  it("keeps the debrief gated until all simulated stages are observed", () => {
    for (const stage of [0, 1, 2] as const) {
      const state = { ...experiment, stage };
      expect(lessonReducer(state, { type: "next" })).toEqual(state);
    }
  });
  it("replaces A with a new C and waits for readiness", () => {
    expect(simulatedPods(0)).toEqual([{ id: "A", status: "ready" }, { id: "B", status: "ready" }]);
    expect(simulatedPods(1)[0]).toEqual({ id: "A", status: "missing" });
    expect(simulatedPods(2)[0]).toEqual({ id: "C", status: "starting" });
    expect(simulatedPods(3)[0]).toEqual({ id: "C", status: "ready" });
    expect([0, 1, 2, 3].map((stage) => simulatedPods(stage as LessonState["stage"]).filter((pod) => pod.status === "ready").length)).toEqual([2, 1, 1, 2]);
  });
  it("can reset from every stage, clearing prediction and progress", () => {
    for (const stage of [0, 1, 2, 3] as const) expect(lessonReducer({ ...experiment, stage }, { type: "reset" })).toEqual(initialLesson);
    expect(lessonReducer({ ...experiment, step: 3 }, { type: "reset" })).toEqual(initialLesson);
  });
  it("returns safely to prediction and restarts the model on re-entry", () => {
    const back = lessonReducer({ ...experiment, stage: 2 }, { type: "back" });
    expect(back).toEqual({ step: 1, stage: 0, prediction: 1 });
    expect(lessonReducer(back, { type: "next" })).toEqual(experiment);
    expect(lessonReducer(initialLesson, { type: "back" })).toEqual(initialLesson);
  });
  it("ships the full module in all four languages", () => {
    for (const locale of locales) {
      const content = learningMessages[locale];
      expect(Object.keys(content).sort()).toEqual(Object.keys(learningMessages.es).sort());
      expect(content.steps).toHaveLength(4);
      expect(content.stages).toHaveLength(4);
      expect(content.predictions).toHaveLength(3);
      expect(content.concepts).toHaveLength(3);
      expect(content.simulationNotice.length).toBeGreaterThan(20);
      expect(content.caveat.length).toBeGreaterThan(20);
    }
  });
  it("keeps lesson modules independent from real API/auth/telemetry clients", () => {
    for (const path of ["lib/learning.ts", "components/learning/pod-lesson.tsx", "components/learning/pod-simulator.tsx", "components/learning/lesson-shell.tsx"]) {
      const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/\bfetch\s*\(|WebSocket|signalr|@\/lib\/(api|telemetry)|\/api\/|\/auth\/|\/hubs\//i);
    }
  });
});
