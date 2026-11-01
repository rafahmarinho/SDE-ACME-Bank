import { activityLog } from "./http";

/** Records the start of this server instance and, at exit, its stop (Node.js runtime only). */
export function recordServerLifecycle() {
  activityLog({
    event: "server-start",
    node: process.version,
    mode: process.env.NODE_ENV,
    region: process.env.VERCEL_REGION ?? "local",
  });
  // "exit" does not change how the process handles signals (Next.js keeps its own shutdown).
  process.once("exit", (code) => activityLog({ event: "server-stop", code }));
}
