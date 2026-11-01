/** Runs once when a server instance starts. Node.js-only code is loaded only in that runtime. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordServerLifecycle } = await import("./services/server-lifecycle");
    recordServerLifecycle();
  }
}
