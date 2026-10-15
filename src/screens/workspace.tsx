"use client";
import { useState } from "react";
import {
  Download,
  FileText,
  Send,
  Plus,
  CheckCheck,
  Play,
  RotateCcw,
  CalendarClock,
  Users,
  Clock3,
  Activity as ActivityIcon,
  ShieldCheck,
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
import { money } from "@/services/bank";
import type { BankContext } from "@/services/use-bank";
import { exportStatement } from "@/services/statements";
import { demoEnabled } from "@/services/use-bank";
import { supabase } from "@/database/supabase";

export function Statements({ bank }: { bank: BankContext }) {
  const state = bank.state!;
  const [account, setAccount] = useState(state.accounts[0]?.id || "");
  const [busy, setBusy] = useState("");
  const months = [
    ...new Set([
      state.clock.slice(0, 7),
      ...state.transactions
        .filter((item) => item.account === account)
        .map((item) => item.date.slice(0, 7)),
    ]),
  ]
    .sort()
    .reverse();
  async function download(month: string, format: "csv" | "pdf") {
    setBusy(`${month}-${format}`);
    bank.setError("");
    try {
      const selected = state.accounts.find((item) => item.id === account);
      if (!selected) throw new Error("Choose an account.");
      await exportStatement(
        selected,
        state.transactions,
        month,
        format,
        bank.actor!.id,
      );
      bank.setNotice(
        supabase
          ? "Statement saved privately and downloaded."
          : "Statement downloaded.",
      );
    } catch (problem) {
      bank.setError(
        problem instanceof Error
          ? problem.message
          : "Unable to export statement.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <Heading
        eyebrow="YOUR RECORDS"
        title="Statements"
        description="A clear record of every month."
      />
      <div className="filter-bar">
        <select
          aria-label="Statement account"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
        >
          {state.accounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.number.slice(-4)}
            </option>
          ))}
        </select>
        <span className="muted small">USD · CSV amounts are in cents</span>
      </div>
      <section className="section">
        {months.map((month) => (
          <div className="list-row" key={month}>
            <span className="icon-box peach">
              <FileText size={21} />
            </span>
            <div>
              <strong>
                {new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              <p className="muted small">
                {
                  state.transactions.filter(
                    (item) =>
                      item.account === account && item.date.startsWith(month),
                  ).length
                }{" "}
                transactions
                {month === state.clock.slice(0, 7)
                  ? " · Month to date"
                  : " · Monthly statement"}
              </p>
            </div>
            <div className="row ml-auto">
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => download(month, "csv")}
              >
                <Download size={16} />
                {busy === `${month}-csv` ? "Exporting…" : "CSV"}
              </Button>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => download(month, "pdf")}
              >
                <Download size={16} />
                {busy === `${month}-pdf` ? "Exporting…" : "PDF"}
              </Button>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
export function ProfileSettings({
  bank,
  settings = false,
}: {
  bank: BankContext;
  settings?: boolean;
}) {
  const profile = bank.state!.customers.find(
    (item) => item.id === bank.actor!.id,
  )!;
  const [name, setName] = useState(profile.name);
  const [notifications, setNotifications] = useState(profile.notifications);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    bank.setError("");
    setPasswordBusy(true);
    try {
      if (!supabase)
        throw new Error(
          "Password changes require a Supabase account. Demo profiles have no password.",
        );
      const { error: authenticationError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: currentPassword,
      });
      if (authenticationError)
        throw new Error("Current password is incorrect.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error)
        throw new Error(
          "Password update failed. Reauthenticate and try again.",
        );
      setPassword("");
      setCurrentPassword("");
      bank.setNotice("Password updated.");
    } catch (problem) {
      bank.setError(
        problem instanceof Error ? problem.message : "Password update failed.",
      );
    } finally {
      setPasswordBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="YOUR PREFERENCES"
        title={settings ? "Settings" : "Your profile"}
        description={
          settings
            ? "Make your banking space your own."
            : "Keep your details up to date."
        }
      />
      <div className="form-layout">
        <section className="form-section">
          <h2>{settings ? "Account preferences" : "Personal details"}</h2>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void bank.act({ type: "profile", name, notifications });
            }}
          >
            <Field label="Full name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
              />
            </Field>
            <Field label="Email address">
              <Input value={profile.email} disabled />
            </Field>
            <Field label="Account role">
              <Input value={profile.role} disabled />
            </Field>
            <label className="check-label">
              <input
                type="checkbox"
                checked={notifications}
                onChange={(event) => setNotifications(event.target.checked)}
              />
              Enable account notifications
            </label>
            <Button
              className="primary-action"
              type="submit"
              disabled={bank.busy}
            >
              Save changes
            </Button>
          </form>
          {settings && (
            <>
              <hr className="my-8" />
              <h2>Security</h2>
              <form className="stack" onSubmit={changePassword}>
                <Field label="Current password">
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    maxLength={128}
                    required
                  />
                </Field>
                <Field
                  label="New password"
                  hint="At least 12 characters. Use a unique password."
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </Field>
                <Button variant="outline" type="submit" disabled={passwordBusy}>
                  Update password
                </Button>
              </form>
            </>
          )}
        </section>
        <aside className="form-aside">
          <ShieldCheck size={28} />
          <h3>Privacy comes first.</h3>
          <p className="muted">
            Only your own accounts and records are available to your customer
            profile. Support can help with requests; only administrators can run
            simulations.
          </p>
          <hr />
          <p className="muted small">
            Default language: English
            <br />
            Currency: USD
            <br />
            Timezone: UTC
            <br />
            Banking environment:{" "}
            {demoEnabled ? "Local demo" : "Supabase simulation"}
          </p>
        </aside>
      </div>
    </>
  );
}
export function Support({ bank }: { bank: BankContext }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const staff = bank.actor!.role !== "customer";
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (
      await bank.act(
        {
          type: "ticket",
          subject: String(form.get("subject")),
          message: String(form.get("message")),
        },
        "Support request sent.",
      )
    )
      setOpen(false);
  }
  return (
    <>
      <Heading
        eyebrow={staff ? "SERVICE DESK" : "HERE FOR YOU"}
        title={staff ? "Support queue" : "Support"}
        description={
          staff
            ? "Help customers move forward."
            : "A human moment in a digital bank."
        }
        action={
          <Button className="primary-action" onClick={() => setOpen(true)}>
            <Plus size={16} />
            New request
          </Button>
        }
      />
      <div className="filter-bar">
        <Input
          className="max-w-sm"
          aria-label="Search support requests"
          placeholder="Search requests"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Filter support status"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All requests</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>
      <div className="ticket-list">
        {bank
          .state!.tickets.filter(
            (item) =>
              (filter === "all" || item.status === filter) &&
              `${item.subject} ${item.message}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
          .map((ticket) => (
            <article className="ticket" key={ticket.id}>
              <div className="section-top">
                <h3>{ticket.subject}</h3>
                <Status value={ticket.status} />
              </div>
              <p className="muted small">
                {
                  bank.state!.customers.find((item) => item.id === ticket.owner)
                    ?.name
                }{" "}
                · {ticket.id.slice(0, 8)}
              </p>
              <p className="ticket-message">{ticket.message}</p>
              {ticket.replies.map((reply, index) => (
                <div className="reply" key={index}>
                  <strong className="small">
                    {bank.state!.customers.find(
                      (item) => item.id === reply.author,
                    )?.name || "Bank staff"}
                  </strong>
                  <p>{reply.text}</p>
                  <small className="muted">
                    {new Date(reply.date).toLocaleString("en-US", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC
                  </small>
                </div>
              ))}
              {ticket.status === "open" && (
                <form
                  className="reply-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const values = new FormData(form);
                    if (
                      await bank.act(
                        {
                          type: "reply",
                          id: ticket.id,
                          message: String(values.get("message")),
                          resolve: values.get("resolve") === "on",
                        },
                        "Reply saved.",
                      )
                    )
                      form.reset();
                  }}
                >
                  <Input
                    name="message"
                    aria-label={`Reply to ${ticket.subject}`}
                    placeholder="Write a reply…"
                    required
                    maxLength={2000}
                  />
                  {staff && (
                    <label className="check-label small">
                      <input name="resolve" type="checkbox" />
                      Resolve
                    </label>
                  )}
                  <Button
                    type="submit"
                    size="icon"
                    aria-label="Send reply"
                    disabled={bank.busy}
                  >
                    <Send size={16} />
                  </Button>
                </form>
              )}
            </article>
          ))}
      </div>
      {!bank.state!.tickets.length && (
        <Empty
          title="All clear"
          description="Need a hand? Open a support request."
        />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>How can we help?</DialogTitle>
          <DialogDescription>
            Never include passwords, real account details or card numbers.
          </DialogDescription>
          <form className="stack" onSubmit={create}>
            <Field label="Subject">
              <Input name="subject" required maxLength={200} />
            </Field>
            <Field label="Message">
              <textarea
                name="message"
                rows={4}
                required
                minLength={5}
                maxLength={2000}
              />
            </Field>
            <Button type="submit" disabled={bank.busy}>
              <Send size={16} />
              Send request
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function Staff({
  bank,
  navigate,
}: {
  bank: BankContext;
  navigate: (page: string) => void;
}) {
  const state = bank.state!;
  const admin = bank.actor!.role === "administrator";
  const customers = state.customers.filter((item) => item.role === "customer");
  const [customer, setCustomer] = useState(customers[0]?.id || "");
  const [scenario, setScenario] = useState<
    "deposit" | "purchase" | "insufficient" | "pending"
  >("deposit");
  const [days, setDays] = useState(1);
  const [search, setSearch] = useState("");
  return (
    <>
      <Heading
        eyebrow="OPERATIONS"
        title={admin ? "Staff dashboard" : "Support dashboard"}
        description={`Simulation clock: ${new Date(state.clock).toLocaleString("en-US", { timeZone: "UTC" })} UTC`}
        action={
          <Button variant="outline" onClick={() => navigate("support")}>
            <CheckCheck size={16} />
            Open support queue
          </Button>
        }
      />
      <div className="staff-metrics">
        <div>
          <Users size={20} />
          <span className="muted">Customers</span>
          <strong>{customers.length}</strong>
        </div>
        <div>
          <Clock3 size={20} />
          <span className="muted">Pending transfers</span>
          <strong>
            {
              state.transactions.filter((item) => item.status === "pending")
                .length
            }
          </strong>
        </div>
        <div>
          <ActivityIcon size={20} />
          <span className="muted">Total transactions</span>
          <strong>{state.transactions.length}</strong>
        </div>
        <div>
          <CheckCheck size={20} />
          <span className="muted">Open requests</span>
          <strong>
            {state.tickets.filter((item) => item.status === "open").length}
          </strong>
        </div>
      </div>
      {admin && (
        <section className="simulation-section">
          <div className="section-top">
            <h2>Simulation studio</h2>
            <span className="status amber">
              <span />
              Sandbox
            </span>
          </div>
          <div className="simulation-controls">
            <Field label="Customer">
              <select
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
              >
                {customers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Scenario">
              <select
                value={scenario}
                onChange={(event) =>
                  setScenario(event.target.value as typeof scenario)
                }
              >
                <option value="deposit">Salary deposit · $1,500</option>
                <option value="purchase">Card purchase · $42.50</option>
                <option value="insufficient">Insufficient funds</option>
                <option value="pending">Pending transfer · $50</option>
              </select>
            </Field>
            <Button
              className="primary-action"
              disabled={bank.busy}
              onClick={() =>
                bank.act(
                  { type: "scenario", scenario, customer },
                  "Scenario applied.",
                )
              }
            >
              <Play size={16} />
              Run scenario
            </Button>
          </div>
          <div className="simulation-controls secondary-controls">
            <Field label="Advance simulation (days)">
              <Input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              />
            </Field>
            <Button
              variant="outline"
              disabled={bank.busy}
              onClick={() =>
                bank.act(
                  { type: "advance", days },
                  "Simulation advanced. Pending transfers settled and due payments processed.",
                )
              }
            >
              <CalendarClock size={16} />
              Advance clock
            </Button>
            <Button
              variant="destructive"
              disabled={bank.busy}
              onClick={() => {
                if (
                  confirm(
                    "Reset all simulated balances, payments, cards and activity? This cannot be undone.",
                  )
                )
                  void bank.act({ type: "reset" }, "Demo data reset.");
              }}
            >
              <RotateCcw size={16} />
              Reset data
            </Button>
          </div>
        </section>
      )}
      <section className="section">
        <div className="section-top">
          <h2>Customers</h2>
          <Input
            className="max-w-xs"
            aria-label="Search customers"
            placeholder="Search customers"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="table-scroll">
          <table className="activity-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Email</th>
                <th>Accounts</th>
                <th className="amount-cell">Available balance</th>
              </tr>
            </thead>
            <tbody>
              {customers
                .filter((item) =>
                  `${item.name} ${item.email}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    <td className="muted">{item.email}</td>
                    <td>
                      {
                        state.accounts.filter(
                          (account) => account.owner === item.id,
                        ).length
                      }
                    </td>
                    <td className="amount-cell">
                      {money(
                        state.accounts
                          .filter((account) => account.owner === item.id)
                          .reduce((sum, account) => sum + account.balance, 0),
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {admin && (
        <section className="section event-log">
          <h2>
            Event inspector <span className="count">{state.events.length}</span>
          </h2>
          {state.events.map((event) => (
            <div className="event-row" key={event.id}>
              <span className="live-dot" />
              <div>
                <strong>{event.message}</strong>
                <p className="muted small">
                  {event.actor} ·{" "}
                  {new Date(event.date).toLocaleString("en-US", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </p>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
