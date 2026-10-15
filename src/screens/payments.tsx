"use client";
import { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Empty, Field, Heading, Status } from "@/components/banking";
import { feeFor, money, parseMoney } from "@/services/bank";
import type { BankContext } from "@/services/use-bank";

export function Transfer({
  bank,
  scheduled = false,
}: {
  bank: BankContext;
  scheduled?: boolean;
}) {
  const state = bank.state!;
  const [account, setAccount] = useState(state.accounts[0]?.id || "");
  const [beneficiary, setBeneficiary] = useState(
    state.beneficiaries[0]?.id || "",
  );
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(
    new Date(new Date(state.clock).getTime() + 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const [review, setReview] = useState(false);
  const [success, setSuccess] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const selected = state.accounts.find((item) => item.id === account);
  const recipient = state.beneficiaries.find((item) => item.id === beneficiary);
  let cents = 0;
  try {
    cents = parseMoney(amount);
  } catch {
    cents = 0;
  }
  function reviewTransfer(event: React.FormEvent) {
    event.preventDefault();
    bank.setError("");
    try {
      const value = parseMoney(amount);
      if (!selected || !recipient)
        throw new Error("Select an account and beneficiary first.");
      if (!scheduled && selected.balance < value + feeFor(value))
        throw new Error(
          "Insufficient funds to cover the amount and transfer fee.",
        );
      if (scheduled && due <= state.clock.slice(0, 10))
        throw new Error("Choose a future payment date.");
      setReview(true);
    } catch (problem) {
      bank.setError(
        problem instanceof Error
          ? problem.message
          : "Check your transfer details.",
      );
    }
  }
  async function confirm() {
    const ok = await bank.act(
      scheduled
        ? { type: "schedule", account, beneficiary, amount: cents, due }
        : { type: "transfer", account, beneficiary, amount: cents, key },
      scheduled
        ? "Payment scheduled."
        : "Transfer submitted. Funds are reserved until settlement.",
    );
    if (ok) {
      setReview(false);
      setSuccess(true);
      setKey(crypto.randomUUID());
    }
  }
  return (
    <>
      <Heading
        eyebrow="MOVE MONEY"
        title={scheduled ? "Scheduled payments" : "Make a transfer"}
        description={
          scheduled
            ? "Set it up today. Take it off your mind."
            : "From your account to their next possibility."
        }
      />
      <div className="form-layout">
        <section className="form-section">
          <div className="step-label">
            <span>1</span> {scheduled ? "Payment details" : "Transfer details"}
          </div>
          {success ? (
            <div className="empty">
              <CheckCircle2 size={40} className="positive" />
              <h2>{scheduled ? "You're all set" : "Transfer on its way"}</h2>
              <p className="muted">
                {money(cents)} to {recipient?.name}
                {scheduled
                  ? ` on ${due}`
                  : ". Estimated settlement: next simulation day."}
              </p>
              <Button
                onClick={() => {
                  setSuccess(false);
                  setAmount("");
                }}
              >
                Make another {scheduled ? "payment" : "transfer"}
              </Button>
            </div>
          ) : (
            <form onSubmit={reviewTransfer} className="stack">
              <Field label="From account">
                <select
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  required
                >
                  {state.accounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {money(item.balance)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="To beneficiary">
                <select
                  value={beneficiary}
                  onChange={(event) => setBeneficiary(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select a beneficiary
                  </option>
                  {state.beneficiaries.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.bank}
                    </option>
                  ))}
                </select>
              </Field>
              {!state.beneficiaries.length && (
                <p className="muted">
                  Add a beneficiary in Beneficiaries before making a payment.
                </p>
              )}
              <Field label="Amount" hint="USD · maximum $1,000,000.00">
                <div className="amount-input">
                  <span>$</span>
                  <Input
                    aria-label="Amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                  />
                </div>
              </Field>
              {scheduled && (
                <Field label="Payment date">
                  <Input
                    aria-label="Payment date"
                    type="date"
                    min={new Date(new Date(state.clock).getTime() + 86400000)
                      .toISOString()
                      .slice(0, 10)}
                    value={due}
                    onChange={(event) => setDue(event.target.value)}
                    required
                  />
                </Field>
              )}
              <div className="fee-preview">
                <div className="row">
                  <span>Transfer amount</span>
                  <strong>{money(cents)}</strong>
                </div>
                <div className="row">
                  <span>Transfer fee</span>
                  <strong>{cents ? money(feeFor(cents)) : "$0.00"}</strong>
                </div>
                <div className="row fee-total">
                  <span>Total debit</span>
                  <strong>
                    {cents ? money(cents + feeFor(cents)) : "$0.00"}
                  </strong>
                </div>
              </div>
              <Button
                className="primary-action"
                type="submit"
                disabled={bank.busy || !selected || !recipient}
              >
                Review {scheduled ? "payment" : "transfer"}
                <ArrowRight size={16} />
              </Button>
            </form>
          )}
        </section>
        <aside className="form-aside">
          <ShieldCheck size={28} />
          <h3>Clear fees. No surprises.</h3>
          <p className="muted">
            A 0.25% transfer fee applies, with a $0.25 minimum. Your total is
            shown before you confirm.
          </p>
          <hr />
          <p className="small muted">
            {scheduled
              ? "Scheduled payments debit funds when their date arrives. Payments may fail if funds are unavailable."
              : "Funds are reserved immediately. Transfers stay pending until the simulation advances one day."}
          </p>
          <p className="small muted">
            External banks and settlement are simulated. No real money moves.
          </p>
        </aside>
      </div>
      {scheduled && (
        <section className="section payment-list">
          <h2>Payment calendar</h2>
          {!state.payments.length && (
            <Empty
              title="Your calendar is clear"
              description="Schedule your first payment above."
            />
          )}
          {state.payments.map((payment) => (
            <div className="list-row" key={payment.id}>
              <span className="icon-box peach">
                <CalendarClock size={20} />
              </span>
              <div>
                <strong>
                  {state.beneficiaries.find(
                    (item) => item.id === payment.beneficiary,
                  )?.name || "Removed beneficiary"}
                </strong>
                <p className="muted small">
                  Due {payment.due} · fee {money(feeFor(payment.amount))}
                </p>
              </div>
              <strong className="ml-auto">{money(payment.amount)}</strong>
              <Status value={payment.status} />
              {payment.status === "scheduled" && (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Cancel payment"
                  aria-label="Cancel payment"
                  disabled={bank.busy}
                  onClick={() =>
                    bank.act(
                      { type: "cancel-payment", id: payment.id },
                      "Payment cancelled.",
                    )
                  }
                >
                  <X size={17} />
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent>
          <DialogTitle>
            Confirm {scheduled ? "scheduled payment" : "transfer"}
          </DialogTitle>
          <DialogDescription>
            Review the destination, amount and fee before confirming.
          </DialogDescription>
          <div className="review-recipient">
            <UserRound />
            <strong>{recipient?.name}</strong>
            <p className="muted small">
              {recipient?.bank} · ending {recipient?.account.slice(-4)}
            </p>
          </div>
          <div className="fee-preview">
            <div className="row">
              <span>Amount</span>
              <strong>{money(cents)}</strong>
            </div>
            <div className="row">
              <span>Fee</span>
              <strong>{money(feeFor(cents))}</strong>
            </div>
            <div className="row fee-total">
              <span>Total debit</span>
              <strong>{money(cents + feeFor(cents))}</strong>
            </div>
            {scheduled && <p className="muted small">Payment date: {due}</p>}
          </div>
          {bank.error && (
            <p className="text-red-700" role="alert">
              {bank.error}
            </p>
          )}
          <Button
            className="primary-action"
            disabled={bank.busy}
            onClick={confirm}
          >
            <Send size={16} />
            {bank.busy ? "Processing…" : "Confirm payment"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function Beneficiaries({ bank }: { bank: BankContext }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (
      await bank.act(
        {
          type: "beneficiary",
          name: String(values.get("name")),
          account: String(values.get("account")),
          bank: String(values.get("bank")),
        },
        "Beneficiary added.",
      )
    )
      setOpen(false);
  }
  return (
    <>
      <Heading
        eyebrow="YOUR PEOPLE"
        title="Beneficiaries"
        description="Trusted destinations for your money."
        action={
          <Button className="primary-action" onClick={() => setOpen(true)}>
            <Plus size={16} />
            Add beneficiary
          </Button>
        }
      />
      <Input
        className="mb-6 max-w-sm"
        aria-label="Search beneficiaries"
        placeholder="Search beneficiaries"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <section className="section">
        {bank
          .state!.beneficiaries.filter((item) =>
            `${item.name} ${item.bank} ${item.account}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((item) => (
            <div className="list-row" key={item.id}>
              <span className="person-avatar">
                {item.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{item.name}</strong>
                <p className="muted small">
                  {item.bank} · {item.account}
                </p>
              </div>
              <Button
                className="ml-auto"
                size="icon"
                variant="ghost"
                title="Remove beneficiary"
                aria-label={`Remove ${item.name}`}
                disabled={bank.busy}
                onClick={() => {
                  if (confirm(`Remove ${item.name}?`))
                    void bank.act({ type: "remove-beneficiary", id: item.id });
                }}
              >
                <Trash2 size={17} />
              </Button>
            </div>
          ))}
        {!bank.state!.beneficiaries.length && (
          <Empty
            title="No beneficiaries yet"
            description="Add a person or business you pay regularly."
          />
        )}
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Add a beneficiary</DialogTitle>
          <DialogDescription>
            Use a simulated account number. No real banking connection is made.
          </DialogDescription>
          <form onSubmit={add} className="stack">
            <Field label="Full name">
              <Input name="name" required maxLength={200} />
            </Field>
            <Field label="Account number">
              <Input
                name="account"
                required
                pattern="[0-9]{8,20}"
                inputMode="numeric"
                maxLength={20}
              />
            </Field>
            <Field label="Bank name">
              <Input
                name="bank"
                required
                defaultValue="ACME Bank"
                maxLength={200}
              />
            </Field>
            {bank.error && <p className="text-red-700">{bank.error}</p>}
            <Button
              type="submit"
              className="primary-action"
              disabled={bank.busy}
            >
              <Plus size={16} />
              Save beneficiary
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
