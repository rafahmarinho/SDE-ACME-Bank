"use client";
import { useState } from "react";
import Image from "next/image";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  Download,
  Plus,
  Send,
  ChevronRight,
  TrendingUp,
} from "lucide-react";
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import {
  AccountTile,
  ActivityTable,
  BankCard,
  Heading,
  Shortcut,
} from "@/components/banking";
import { money } from "@/services/bank";
import type { BankContext } from "@/services/use-bank";

export function Overview({
  bank,
  navigate,
}: {
  bank: BankContext;
  navigate: (page: string) => void;
}) {
  const state = bank.state!;
  const profile = state.customers.find((item) => item.id === bank.actor!.id)!;
  const [period, setPeriod] = useState("month");
  const total = state.accounts.reduce((sum, item) => sum + item.balance, 0);
  const cutoff = new Date(
    new Date(state.clock).getTime() - (period === "week" ? 7 : 30) * 86400000,
  ).toISOString();
  const activity = state.transactions.filter(
    (item) => item.date >= cutoff && item.status !== "failed",
  );
  const income = activity.reduce(
    (sum, item) => sum + Math.max(0, item.amount),
    0,
  );
  const spending = -activity.reduce(
    (sum, item) => sum + Math.min(0, item.amount),
    0,
  );
  const opening = total - activity.reduce((sum, item) => sum + item.amount, 0);
  const chart = Array.from(
    { length: period === "week" ? 7 : 30 },
    (_, index) => {
      const date = new Date(new Date(cutoff).getTime() + index * 86400000)
        .toISOString()
        .slice(0, 10);
      const running = opening + activity
        .filter((item) => item.date.slice(0, 10) <= date)
        .reduce((sum, item) => sum + item.amount, 0);
      return {
        day: new Date(date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        balance: running / 100,
      };
    },
  );
  const recent = [...state.transactions]
    .sort((first, second) => second.date.localeCompare(first.date))
    .slice(0, 5);
  return (
    <>
      <Heading
        eyebrow="YOUR MONEY, AT A GLANCE"
        title={`Good morning, ${profile.name.split(" ")[0]}`}
        description="A little clarity for the day ahead."
        action={
          <Button
            className="primary-action"
            onClick={() => navigate("transfers")}
          >
            <Plus size={17} />
            Make a transfer
          </Button>
        }
      />
      <div className="overview-grid">
        <div className="overview-main">
          <section className="balance-section">
            <div className="section-top">
              <p className="muted">Total available balance</p>
              <span className="currency-pill">USD</span>
            </div>
            <div className="total-balance">
              {money(total)}
              <span className="balance-change">
                <TrendingUp size={14} /> Across {state.accounts.length} accounts
              </span>
            </div>
            <div className="income-grid">
              <div>
                <span className="circle-icon mint">
                  <ArrowDownLeft size={19} />
                </span>
                <div>
                  <p className="muted small">Money in</p>
                  <strong>{money(income)}</strong>
                </div>
              </div>
              <div>
                <span className="circle-icon peach">
                  <ArrowUpRight size={19} />
                </span>
                <div>
                  <p className="muted small">Money out</p>
                  <strong>{money(spending)}</strong>
                </div>
              </div>
              <div className="period-select">
                <button
                  className={period === "month" ? "active" : ""}
                  onClick={() => setPeriod("month")}
                >
                  30 days
                </button>
                <button
                  className={period === "week" ? "active" : ""}
                  onClick={() => setPeriod("week")}
                >
                  7 days
                </button>
              </div>
            </div>
            <div className="balance-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chart}
                  margin={{ top: 15, right: 8, left: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="balance-fill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#f47c35"
                        stopOpacity={0.16}
                      />
                      <stop offset="95%" stopColor="#f47c35" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={60}
                    tick={{ fontSize: 11, fill: "#858a94" }}
                  />
                  <Tooltip
                    formatter={(value) => `$${Number(value).toLocaleString()}`}
                    contentStyle={{
                      borderRadius: 6,
                      borderColor: "#e6e8eb",
                      fontSize: 12,
                    }}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="balance"
                    stroke="#ed7130"
                    strokeWidth={2.5}
                    fill="url(#balance-fill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="section">
            <div className="section-top">
              <h2>
                Your accounts{" "}
                <span className="count">{state.accounts.length}</span>
              </h2>
              <button
                className="text-link"
                onClick={() => navigate("accounts")}
              >
                View accounts <ChevronRight size={15} />
              </button>
            </div>
            <div className="account-grid">
              {state.accounts.map((account) => (
                <AccountTile
                  key={account.id}
                  account={account}
                  onClick={() => navigate("accounts")}
                />
              ))}
            </div>
          </section>
          <section className="section activity-section">
            <div className="section-top">
              <h2>Recent activity</h2>
              <button
                className="text-link"
                onClick={() => navigate("activity")}
              >
                View all activity <ChevronRight size={15} />
              </button>
            </div>
            <ActivityTable
              transactions={recent}
              accounts={state.accounts}
              compact
            />
          </section>
        </div>
        <aside className="overview-aside">
          <section className="section">
            <h2>Quick actions</h2>
            <div className="quick-actions">
              <Shortcut
                icon={<Send size={19} />}
                title="Transfer"
                onClick={() => navigate("transfers")}
              />
              <Shortcut
                icon={<CalendarClock size={19} />}
                title="Schedule"
                onClick={() => navigate("scheduled")}
              />
              <Shortcut
                icon={<Download size={19} />}
                title="Statements"
                onClick={() => navigate("statements")}
              />
            </div>
          </section>
          <section className="section">
            <div className="section-top">
              <h2>Your card</h2>
              <button className="text-link" onClick={() => navigate("cards")}>
                Manage <ChevronRight size={15} />
              </button>
            </div>
            {state.cards[0] && (
              <BankCard card={state.cards[0]} name={profile.name} />
            )}
            <div className="card-summary">
              <span className="muted small">Monthly spending</span>
              <strong>
                {money(state.cards[0]?.spent || 0)}{" "}
                <span className="muted">
                  / {money(state.cards[0]?.limit || 0)}
                </span>
              </strong>
              <div className="progress-track">
                <span
                  style={{
                    width: `${Math.min(100, ((state.cards[0]?.spent || 0) / (state.cards[0]?.limit || 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </section>
          <section className="section upcoming">
            <div className="section-top">
              <h2>Coming up</h2>
              <CalendarClock size={17} className="muted" />
            </div>
            {state.payments
              .filter((item) => item.status === "scheduled")
              .slice(0, 3)
              .map((payment) => (
                <div className="upcoming-payment" key={payment.id}>
                  <div className="date-box">
                    <small>
                      {new Date(payment.due)
                        .toLocaleDateString("en-US", { month: "short" })
                        .toUpperCase()}
                    </small>
                    <strong>{payment.due.slice(-2)}</strong>
                  </div>
                  <div>
                    <strong>
                      {
                        state.beneficiaries.find(
                          (item) => item.id === payment.beneficiary,
                        )?.name
                      }
                    </strong>
                    <p className="muted small">Scheduled payment</p>
                  </div>
                  <strong className="ml-auto">{money(payment.amount)}</strong>
                </div>
              ))}
            {!state.payments.some((item) => item.status === "scheduled") && (
              <p className="muted">Nothing scheduled. A clear calendar.</p>
            )}
            <button className="text-link" onClick={() => navigate("scheduled")}>
              Manage payments <ChevronRight size={15} />
            </button>
          </section>
          <div className="editorial-banner">
            <Image
              width={800}
              height={600}
              unoptimized
              src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=80"
              alt="Sunlight through a green forest"
            />
            <div>
              <span>ROOM TO GROW</span>
              <h3>
                Your next chapter.
                <br />
                Your own pace.
              </h3>
              <button onClick={() => navigate("accounts")}>
                Explore your savings <ArrowUpRight size={16} />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
