"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/banking";
import { supabase } from "@/database/supabase";
import type { BankContext } from "@/services/use-bank";

export function MFA({ bank }: { bank: BankContext }) {
  const [factor, setFactor] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void supabase!.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active) return;
      if (error) setError("Unable to load authentication factors.");
      else setFactor(data.totp.find(item => item.status === "verified")?.id || "");
    });
    return () => { active = false; };
  }, []);
  async function enroll() {
    setBusy(true); setError("");
    const factors = await supabase!.auth.mfa.listFactors();
    for (const pending of factors.data?.all.filter(item => item.status === "unverified") || []) await supabase!.auth.mfa.unenroll({ factorId: pending.id });
    const { data, error } = await supabase!.auth.mfa.enroll({ factorType: "totp", friendlyName: "ACME Bank authenticator" });
    if (error) setError("Unable to start enrollment. Please retry.");
    else { setFactor(data.id); setQr(data.totp.qr_code.trim()); }
    setBusy(false);
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const { error } = await supabase!.auth.mfa.challengeAndVerify({ factorId: factor, code });
    if (error) setError("Invalid or expired code. Try the current code from your authenticator.");
    else { setQr(""); setCode(""); await bank.refresh(); }
    setBusy(false);
  }
  return <main className="loading-page"><section className="mfa-form stack"><ShieldCheck size={32} className="positive" /><h1>One more secure step</h1><p className="muted">Multi-factor authentication is required to access ACME Bank.</p>{error && <p className="alert error" role="alert">{error}</p>}{!factor ? <Button className="primary-action" onClick={enroll} disabled={busy}>Set up authenticator</Button> : <form className="stack" onSubmit={verify}>{qr && <><Image unoptimized src={qr} width={220} height={220} alt="Scan with your authenticator application" /><p className="muted small">Scan this QR code with your authenticator app, then enter its six-digit code. Never share this code or QR image.</p></>}<Field label="Authenticator code"><Input aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} pattern="[0-9]{6}" maxLength={6} required /></Field><Button type="submit" className="primary-action" disabled={busy}>{busy ? "Verifying…" : "Verify and continue"}</Button></form>}<Button variant="ghost" onClick={bank.signOut}>Sign out</Button></section></main>;
}