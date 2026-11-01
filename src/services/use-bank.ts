"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { configured, supabase } from "@/database/supabase";
import { forgetStorageKey } from "@/database/secure-storage";
import {
  errorMessage,
  executeAction,
  seedBank,
  visibleState,
  type Action,
  type Actor,
  type BankState,
  type BankView,
} from "./bank";
import { sessionLimits } from "./session-policy";

const storageKey = "acme-bank-demo-v1";
// The unauthenticated demo (role switcher, browser-only data) exists only in `next dev` builds
// without Supabase settings. Production builds compile it out, whatever the environment says.
export const demoEnabled = process.env.NODE_ENV === "development" && !configured;
function readDemo(): BankState {
  const value = localStorage.getItem(storageKey);
  if (!value) return seedBank();
  try {
    const state = JSON.parse(value) as BankState;
    if (!Array.isArray(state.accounts) || !Array.isArray(state.customers))
      throw new Error();
    return state;
  } catch {
    throw new Error(
      "Demo data is damaged. Clear this site's storage to reinitialize.",
    );
  }
}
const sessionEnds = new Set(["unauthorized", "session_idle", "session_expired"]);
/** The API ended this session (idle lock, absolute limit or revoked token): sign in again. */
class SessionEnded extends Error {}
export async function apiRequest(action?: Action, passive = false) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in to continue.");
  const response = await fetch("/api/bank", {
    method: action ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      // Background refreshes must not keep an unattended session alive.
      ...(passive ? { "X-Session-Activity": "passive" } : {}),
    },
    ...(action ? { body: JSON.stringify(action) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && sessionEnds.has(payload.code))
    throw new SessionEnded(payload.error || "Please sign in again.");
  if (!response.ok)
    throw new Error(payload.error || "Unable to reach the bank. Please retry.");
  return payload as { state: BankView; actor: Actor };
}
/** Asks the browser to drop this site's cache, cookies and storage, and clears storage directly too. */
async function clearBrowserData() {
  forgetStorageKey();
  await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    // Storage can be unavailable (for example, blocked by the browser): nothing left to clear.
  }
}
const idleMessage = `Your session was locked after ${sessionLimits.idleMinutes} minutes of inactivity. Please sign in again.`;
export function useBank() {
  const [state, setState] = useState<BankView | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lastInput = useRef(0);
  const lastActiveRequest = useRef(0);
  // After a demo sign-out, stay signed out until a demo profile is picked again.
  const demoSignedOut = useRef(false);
  const endSession = useCallback(async (message: string) => {
    demoSignedOut.current = demoEnabled;
    setNotice("");
    setError(message);
    setMfaRequired(false);
    setActor(null);
    setState(null);
    // Global sign-out revokes every refresh token of the user; local data is cleared either way.
    if (!demoEnabled) await supabase?.auth.signOut().catch(() => undefined);
    await clearBrowserData();
  }, []);
  const load = useCallback(
    async (passive: boolean) => {
      try {
        if (demoEnabled) {
          if (demoSignedOut.current) return;
          const full = readDemo();
          const id = localStorage.getItem("acme-demo-actor") || "customer-1";
          const profile =
            full.customers.find((item) => item.id === id) || full.customers[0];
          const nextActor = { id: profile.id, role: profile.role };
          setActor(nextActor);
          setState(visibleState(full, nextActor));
        } else if (supabase) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            setMfaRequired(false);
            setActor(null);
            setState(null);
            return;
          }
          const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (assuranceError) throw new Error("Unable to verify session security.");
          if (assurance?.currentLevel !== "aal2") { setMfaRequired(true); setState(null); setActor(null); return; }
          setMfaRequired(false);
          const result = await apiRequest(undefined, passive);
          if (!passive) lastActiveRequest.current = Date.now();
          setActor(result.actor);
          setState(result.state);
        }
      } catch (problem) {
        if (problem instanceof SessionEnded) await endSession(problem.message);
        else
          setError(
            problem instanceof Error ? problem.message : "Unable to load accounts.",
          );
      } finally {
        setLoading(false);
      }
    },
    [endSession],
  );
  const refresh = useCallback(() => load(false), [load]);
  useEffect(() => {
    const initial = setTimeout(() => void load(false), 0);
    const onStorage = () => {
      void load(true);
    };
    window.addEventListener("storage", onStorage);
    // Automatic token refreshes are background work, not user activity.
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      setTimeout(() => void load(event === "TOKEN_REFRESHED"), 0);
    });
    return () => {
      clearTimeout(initial);
      window.removeEventListener("storage", onStorage);
      subscription?.data.subscription.unsubscribe();
    };
  }, [load]);
  useEffect(() => {
    if (!supabase || !actor) return;
    const channel = supabase
      .channel(`profile-${actor.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${actor.id}`,
        },
        () => {
          void load(true);
        },
      )
      .subscribe();
    return () => {
      void supabase!.removeChannel(channel);
    };
  }, [actor, load]);
  // Idle lock: without keyboard, pointer or scroll input for the idle limit the session ends here,
  // and the API refuses the same session after the same time. While the user is active, an
  // occasional refresh tells the API so, because in-app navigation makes no API calls.
  useEffect(() => {
    if (!actor) return;
    lastInput.current = Date.now();
    const onInput = () => {
      lastInput.current = Date.now();
      if (!demoEnabled && Date.now() - lastActiveRequest.current > 5 * 60_000) {
        lastActiveRequest.current = Date.now();
        void load(false);
      }
    };
    const inputs = ["pointerdown", "keydown", "wheel", "touchstart"];
    for (const name of inputs)
      window.addEventListener(name, onInput, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - lastInput.current > sessionLimits.idleMinutes * 60_000)
        void endSession(idleMessage);
    }, 15_000);
    return () => {
      for (const name of inputs) window.removeEventListener(name, onInput);
      clearInterval(timer);
    };
  }, [actor, endSession, load]);
  async function act(action: Action, message = "Changes saved.") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!actor) throw new Error("Please sign in.");
      if (demoEnabled) {
        await navigator.locks.request("acme-bank-demo", () => {
          const next = executeAction(readDemo(), actor, action);
          localStorage.setItem(storageKey, JSON.stringify(next));
          setState(visibleState(next, actor));
        });
      } else {
        const result = await apiRequest(action);
        lastActiveRequest.current = Date.now();
        setState(result.state);
      }
      setNotice(message);
      return true;
    } catch (problem) {
      if (problem instanceof SessionEnded) {
        await endSession(problem.message);
        return false;
      }
      setError(
        demoEnabled
          ? errorMessage(problem)
          : problem instanceof Error
            ? problem.message
            : "Operation failed. Please retry.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function switchDemo(id: string) {
    if (!demoEnabled) return;
    demoSignedOut.current = false;
    localStorage.setItem("acme-demo-actor", id);
    setError("");
    void refresh();
  }
  const signOut = useCallback(() => endSession(""), [endSession]);
  return {
    state,
    actor,
    mfaRequired,
    loading,
    busy,
    error,
    notice,
    act,
    refresh,
    switchDemo,
    signOut,
    setError,
    setNotice,
  };
}
export type BankContext = ReturnType<typeof useBank>;
