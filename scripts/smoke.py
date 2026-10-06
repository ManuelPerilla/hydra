"""Exercise local Hydra. --inject deletes exactly one authorized laboratory pod."""
import argparse
import http.cookiejar
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8080")
    parser.add_argument("--inject", action="store_true")
    parser.add_argument("--output", type=Path, default=Path(".local/smoke-results.json"))
    args = parser.parse_args()
    if args.inject and args.url not in ("http://localhost:8080", "http://127.0.0.1:8080"):
        parser.error("Automated injection smoke is limited to the local Hydra origin.")
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(path, payload=None, extra=None):
        headers = {"Content-Type": "application/json"}
        headers.update(extra or {})
        request = urllib.request.Request(args.url + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
        with opener.open(request, timeout=10) as response:
            return json.load(response)

    session = call("/api/session")
    if not session["operator"]:
        raise RuntimeError("Smoke requires the local operator profile.")
    snapshot = call("/api/targets")
    if snapshot["ready"] < 2 or len(snapshot["items"]) < 2:
        raise RuntimeError("Need two eligible Ready pods and a live agent.")
    victim = next(pod for pod in snapshot["items"] if pod["ready"])
    if victim["namespace"] != "chaos-demo":
        raise RuntimeError("Target escaped the laboratory.")
    headers = {"X-CSRF-Token": session["csrfToken"], "Idempotency-Key": str(uuid.uuid4())}
    payload = {"namespace": "chaos-demo", "podName": victim["name"], "podUid": victim["uid"], "dryRun": True}
    dry = call("/api/experiments", payload, headers)
    repeated = call("/api/experiments", payload, headers)
    if dry["id"] != repeated["id"]:
        raise AssertionError("Idempotency repeated a job.")

    def wait_for(job_id):
        deadline = time.monotonic() + 150
        while time.monotonic() < deadline:
            jobs = call("/api/experiments")["items"]
            job = next(value for value in jobs if value["id"] == job_id)
            if job["status"] == "failed":
                raise RuntimeError(job.get("message", "Experiment failed"))
            if job["status"] == "recovered":
                return job
            time.sleep(1)
        raise TimeoutError("Recovery was not observed before the deadline.")

    dry = wait_for(dry["id"])
    after_dry = call("/api/targets")
    if not any(pod["uid"] == victim["uid"] for pod in after_dry["items"]):
        raise AssertionError("Dry-run mutated the target.")
    evidence = {"dryRun": dry, "idempotency": True, "namespace": "chaos-demo", "injected": False}
    print("Dry-run and idempotency passed; target UID still exists.")
    if args.inject:
        headers["Idempotency-Key"] = str(uuid.uuid4())
        payload["dryRun"] = False
        actual = call("/api/experiments", payload, headers)
        actual = wait_for(actual["id"])
        snapshot = call("/api/targets")
        if any(pod["uid"] == victim["uid"] for pod in snapshot["items"]) or snapshot["ready"] < 2:
            raise AssertionError("The original UID persists or desired readiness was not restored.")
        evidence.update({"injected": True, "experiment": actual, "readyAfter": snapshot["ready"]})
        print(f"Exactly one laboratory target recovered; observed duration {actual.get('recoveryMs')} ms.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(f"Evidence saved in {args.output}; no OAuth or agent tokens included.")


if __name__ == "__main__":
    main()
