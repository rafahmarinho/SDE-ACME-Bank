import { NextResponse } from "next/server";
import {
  authenticate,
  loadWorld,
  saveWorld,
  serviceClient,
} from "@/database/server";
import { actionSchema, executeAction, visibleState } from "@/services/bank";
import { ZodError } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const unauthorized = message === "Unauthorized";
  return NextResponse.json(
    {
      error: unauthorized
        ? "Please sign in again."
        : error instanceof ZodError
          ? "Invalid request. Check the supplied values."
          : message,
    },
    { status: unauthorized ? 401 : 400, headers },
  );
}
export async function GET(request: Request) {
  try {
    const actor = await authenticate(request);
    const state = await loadWorld();
    if (!state.customers.some((item) => item.id === actor.id)) {
      return NextResponse.json(
        { error: "Profile is being provisioned. Please retry." },
        { status: 409, headers },
      );
    }
    return NextResponse.json(
      { state: visibleState(state, actor), actor },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      return NextResponse.json(
        { error: "Origin not allowed." },
        { status: 403, headers },
      );
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new Error("JSON required.");
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 8192)
      throw new Error("Request too large.");
    const actor = await authenticate(request);
    const { data: allowed, error: rateError } = await serviceClient().rpc(
      "consume_request",
      { actor_id: actor.id },
    );
    if (rateError || !allowed)
      return NextResponse.json(
        { error: "Too many requests. Try again in a minute." },
        { status: 429, headers },
      );
    const action = actionSchema.parse(JSON.parse(raw));
    for (let attempt = 0; attempt < 5; attempt++) {
      const state = await loadWorld();
      const next = executeAction(state, actor, action);
      if (await saveWorld(next, state.version))
        return NextResponse.json(
          { state: visibleState(next, actor), actor },
          { headers },
        );
    }
    return NextResponse.json(
      { error: "Another operation is in progress. Please retry." },
      { status: 409, headers },
    );
  } catch (error) {
    return failure(error);
  }
}
