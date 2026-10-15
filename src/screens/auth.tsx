"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/banking";
import { supabase } from "@/database/supabase";
import { demoEnabled, type BankContext } from "@/services/use-bank";

export function Auth({ bank }: { bank: BankContext }) {
  const [mode, setMode] = useState<
    "login" | "signup" | "recovery" | "password"
  >("login");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("password");
    });
    const recovery = setTimeout(() => {
      if (window.location.hash.includes("type=recovery")) setMode("password");
    }, 0);
    return () => { clearTimeout(recovery); subscription?.data.subscription.unsubscribe(); };
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    bank.setError("");
    setMessage("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    try {
      if (!supabase)
        throw new Error(
          "Email authentication requires Supabase configuration. Use the demo below to explore.",
        );
      if (mode === "recovery") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/?recovery=1`,
        });
        if (error)
          throw new Error("Unable to send recovery email. Try again later.");
        setMessage(
          "If an account exists for this email, a recovery link has been sent.",
        );
      } else if (mode === "password") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error)
          throw new Error(
            "Unable to update password. Request a new recovery link.",
          );
        setMessage("Password updated. You can continue to your account.");
        window.history.replaceState(null, "", "/");
        await bank.refresh();
      } else if (mode === "signup") {
        if (form.get("consent") !== "on")
          throw new Error("Consent is required to create an account.");
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error)
          throw new Error(
            "Unable to create account. Check your email and password, or try signing in.",
          );
        setMessage(
          "Check your email to confirm your account before signing in.",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw new Error("Email or password is incorrect.");
        await bank.refresh();
      }
    } catch (problem) {
      bank.setError(
        problem instanceof Error ? problem.message : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <aside className="auth-photo">
        <Image
          width={1600}
          height={1200}
          unoptimized
          src="https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1600&q=85"
          alt="A peaceful lakeside landscape"
        />
        <div className="auth-brand">
          acme<span>.</span> <small>BANK</small>
        </div>
        <div className="auth-copy">
          <p>BUILT AROUND YOU</p>
          <h1>
            More life.
            <br />
            Less banking.
          </h1>
          <span>A clear view of your money. Room for what matters.</span>
        </div>
      </aside>
      <section className="auth-form">
        <div className="auth-mobile-brand">
          acme<span>.</span> BANK
        </div>
        <div className="stack">
          <span className="icon-box peach">
            <LockKeyhole size={24} />
          </span>
          <h2>
            {mode === "signup"
              ? "A fresh start"
              : mode === "recovery"
                ? "Reset your password"
                : mode === "password"
                  ? "Choose a new password"
                  : "Welcome back"}
          </h2>
          <p className="muted">
            {mode === "login"
              ? "Sign in to your ACME Bank account."
              : mode === "signup"
                ? "Create your account. Your simulated bank awaits."
                : "Keep your account access secure."}
          </p>
          {bank.error && (
            <div role="alert" className="alert error">
              {bank.error}
            </div>
          )}
          {message && (
            <div role="status" className="alert success">
              {message}
            </div>
          )}
          <form onSubmit={submit} className="stack">
            {mode !== "password" && (
              <Field label="Email address">
                <Input
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  maxLength={254}
                />
              </Field>
            )}
            {mode !== "recovery" && (
              <Field
                label="Password"
                hint={
                  mode !== "login"
                    ? "At least 12 characters. Use a unique password."
                    : undefined
                }
              >
                <Input
                  type="password"
                  name="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                  minLength={mode === "login" ? 1 : 12}
                  maxLength={128}
                />
              </Field>
            )}
            {mode === "signup" && (
              <label className="check-label">
                <input type="checkbox" name="consent" required />
                I consent to ACME Bank storing my email, profile and simulated
                banking records to provide this service. No real funds are held.
              </label>
            )}
            {mode === "login" && (
              <button
                type="button"
                className="text-link self-end"
                onClick={() => setMode("recovery")}
              >
                Forgot password?
              </button>
            )}
            <Button className="primary-action" type="submit" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "recovery"
                    ? "Send recovery link"
                    : mode === "password"
                      ? "Update password"
                      : "Sign in"}
              <ArrowRight size={17} />
            </Button>
          </form>
          <button
            className="text-link"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage("");
              bank.setError("");
            }}
          >
            {mode === "login" ? "New here? Open an account" : "Back to sign in"}
          </button>
          {demoEnabled && (
            <div className="demo-login">
              <p className="eyebrow">EXPLORE THE DEMO</p>
              <div className="row">
                <Button
                  variant="outline"
                  onClick={() => bank.switchDemo("customer-1")}
                >
                  Customer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => bank.switchDemo("support-1")}
                >
                  Support
                </Button>
                <Button
                  variant="outline"
                  onClick={() => bank.switchDemo("admin-1")}
                >
                  Administrator
                </Button>
              </div>
            </div>
          )}
          <p className="trust-note">
            <ShieldCheck size={16} />
            Simulated accounts. Never enter real financial details.
          </p>
        </div>
      </section>
    </main>
  );
}
export function Onboarding({ bank }: { bank: BankContext }) {
  async function open(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await bank.act(
      { type: "onboard", name: String(form.get("name")), consent: true },
      "Your simulated account is open.",
    );
  }
  return (
    <div className="onboarding">
      <ShieldCheck size={40} className="positive" />
      <p className="eyebrow">LET US GET STARTED</p>
      <h1>Your money. A new home.</h1>
      <p className="muted">
        Open an ACME simulated checking account and virtual debit card.
      </p>
      <form onSubmit={open} className="stack">
        <Field label="Full name">
          <Input name="name" required maxLength={200} />
        </Field>
        <div className="terms">
          <h3>Your account at a glance</h3>
          <p>
            No monthly fee. Transfers cost 0.25% (minimum $0.25). No real funds,
            banking rails, deposit insurance, or identity verification.
          </p>
        </div>
        <label className="check-label">
          <input type="checkbox" required />I accept the simulated banking terms
          and privacy notice.
        </label>
        {bank.error && (
          <p role="alert" className="text-red-700">
            {bank.error}
          </p>
        )}
        <Button className="primary-action" type="submit" disabled={bank.busy}>
          Open simulated account
          <ArrowRight size={16} />
        </Button>
      </form>
    </div>
  );
}
