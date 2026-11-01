import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLog } from "../src/services/http";
import { register } from "../src/instrumentation";

const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("server start and stop are recorded on the activity channel without changing signal handling", async () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (line: string) => lines.push(line);
  const env = process.env as Record<string, string | undefined>;
  const saved = env.NEXT_RUNTIME;
  const signals = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
  const exits = process.listenerCount("exit");
  try {
    env.NEXT_RUNTIME = "edge";
    await register();
    assert.equal(lines.length, 0, "nothing to record in the edge runtime");
    env.NEXT_RUNTIME = "nodejs";
    await register();
    const start = JSON.parse(lines[0]);
    assert.deepEqual([start.level, start.channel, start.event, start.node], ["info", "activity", "server-start", process.version]);
    assert.match(start.at, iso);
    assert.equal(process.listenerCount("exit"), exits + 1);
    assert.deepEqual([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")], signals);
    const stop = process.listeners("exit").at(-1)!;
    process.removeListener("exit", stop);
    stop(0);
    assert.deepEqual(JSON.parse(lines[1]), { ...JSON.parse(lines[1]), channel: "activity", event: "server-stop", code: 0 });
  } finally {
    console.info = original;
    env.NEXT_RUNTIME = saved;
  }
});

test("commits and reads of the bank record carry IDs and versions, with a millisecond timestamp", () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (line: string) => lines.push(line);
  try {
    activityLog({ event: "world-commit", route: "POST /api/bank", actor: "customer-1", action: "transfer", version: 7, next: 8 });
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.channel, "activity");
    assert.match(entry.at, iso);
    assert.deepEqual([entry.event, entry.actor, entry.action, entry.version, entry.next], ["world-commit", "customer-1", "transfer", 7, 8]);
  } finally {
    console.info = original;
  }
});
