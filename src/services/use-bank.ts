"use client";
import { useCallback, useEffect, useState } from "react";
import { configured, supabase } from "@/database/supabase";
import {
  executeAction,
  seedBank,
  visibleState,
  type Action,
  type Actor,
  type BankState,
} from "./bank";

const storageKey = "acme-bank-demo-v1";
export const demoEnabled =
  !configured &&
  (process.env.NEXT_PUBLIC_ENABLE_DEMO === "true" ||
    process.env.NODE_ENV === "development");
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
export async function apiRequest(action?: Action) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in to continue.");
  const response = await fetch("/api/bank", {
    method: action ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    ...(action ? { body: JSON.stringify(action) } : {}),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(payload.error || "Unable to reach the bank. Please retry.");
  return payload as { state: BankState; actor: Actor };
}
export function useBank() {
  const [state, setState] = useState<BankState | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try {
      if (demoEnabled) {
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
        const result = await apiRequest();
        setActor(result.actor);
        setState(result.state);
      }
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Unable to load accounts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const onStorage = () => {
      void refresh();
    };
    window.addEventListener("storage", onStorage);
    const subscription = supabase?.auth.onAuthStateChange(() => {
      setTimeout(() => void refresh(), 0);
    });
    return () => {
      clearTimeout(initial);
      window.removeEventListener("storage", onStorage);
      subscription?.data.subscription.unsubscribe();
    };
  }, [refresh]);
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
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase!.removeChannel(channel);
    };
  }, [actor, refresh]);
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
        setState(result.state);
      }
      setNotice(message);
      return true;
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Operation failed. Please retry.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function switchDemo(id: string) {
    localStorage.setItem("acme-demo-actor", id);
    setError("");
    void refresh();
  }
  async function signOut() {
    setNotice(""); setError(""); setMfaRequired(false);
    if (demoEnabled) {
      localStorage.removeItem("acme-demo-actor");
      setActor(null);
      setState(null);
    } else {
      await supabase?.auth.signOut();
      setActor(null);
      setState(null);
    }
  }
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
