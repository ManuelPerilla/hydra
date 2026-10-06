import type { LearningMessages } from "@/i18n/learning";
import { simulatedPods, type LessonState } from "@/lib/learning";

export default function PodSimulator({ stage, t }: { stage: LessonState["stage"]; t: LearningMessages }) {
  const pods = simulatedPods(stage);
  return <div className="lesson-simulator">
    <div className="simulation-heading"><span className="simulation-badge">{t.simulationBadge}</span><span>{t.desiredLabel}: <b>2</b> · {t.readyLabel}: <b>{pods.filter((pod) => pod.status === "ready").length}</b></span></div>
    <div className="simulated-pods">{pods.map((pod) => <div className={`simulated-pod simulated-${pod.status}`} key={pod.id}>
      <span className="simulated-pod-symbol" aria-hidden="true">{pod.status === "missing" ? "−" : pod.status === "starting" ? "◌" : "✓"}</span>
      <strong>{t.podLabel} <bdi>{pod.id}</bdi></strong><span>{t.statuses[pod.status]}</span>
    </div>)}</div>
    <div className="simulation-explanation" role="status" aria-live="polite" aria-atomic="true"><h3>{t.stages[stage].title}</h3><p>{t.stages[stage].body}</p></div>
  </div>;
}
