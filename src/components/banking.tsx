"use client";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CreditCard,
  Coffee,
  ShoppingBag,
  Building2,
  Clock3,
  Wallet,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  money,
  type Account,
  type Card,
  type Transaction,
} from "@/services/bank";
import type { BankContext } from "@/services/use-bank";
import type { ReactNode } from "react";

export function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span
      className={`status ${["settled", "paid", "resolved"].includes(value) ? "green" : ["failed", "cancelled"].includes(value) ? "red" : "amber"}`}
    >
      <span />
      {value === "settled"
        ? "Completed"
        : value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty">
      <Wallet size={28} />
      <h3>{title}</h3>
      <p className="muted">{description}</p>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
export function AccountTile({
  account,
  selected,
  onClick,
}: {
  account: Account;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`account-tile ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <div className="row">
        <span
          className={`icon-box ${account.name.includes("savings") ? "mint" : "peach"}`}
        >
          <Wallet size={20} />
        </span>
        <span className="account-kind">
          {account.name.includes("savings") ? "SAVINGS" : "CHECKING"}
        </span>
        <ChevronRight size={16} className="ml-auto muted" />
      </div>
      <h3>{account.name}</h3>
      <p className="muted small">
        Account ending in {account.number.slice(-4)}
      </p>
      <strong>{money(account.balance)}</strong>
      <div className="row small muted">
        Available balance{" "}
        <span className="ml-auto">
          <span className="live-dot" /> Active
        </span>
      </div>
    </button>
  );
}
function transactionIcon(transaction: Transaction) {
  if (transaction.amount > 0) return <ArrowDownLeft size={18} />;
  if (transaction.kind === "transfer") return <ArrowUpRight size={18} />;
  if (/coffee|brunch/i.test(transaction.description))
    return <Coffee size={18} />;
  if (/salary/i.test(transaction.description)) return <Building2 size={18} />;
  return <ShoppingBag size={18} />;
}
export function ActivityTable({
  transactions,
  accounts,
  compact = false,
}: {
  transactions: Transaction[];
  accounts: Account[];
  compact?: boolean;
}) {
  if (!transactions.length)
    return (
      <Empty
        title="No activity found"
        description="Try another search or date range."
      />
    );
  return (
    <div className="table-scroll">
      <table className="activity-table">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Date</th>
            {!compact && <th>Account</th>}
            <th>Status</th>
            <th className="amount-cell">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>
                <div className="row">
                  <span
                    className={`transaction-icon ${transaction.amount > 0 ? "credit" : ""}`}
                  >
                    {transactionIcon(transaction)}
                  </span>
                  <div>
                    <strong>{transaction.description}</strong>
                    <small className="muted">
                      {transaction.kind === "deposit"
                        ? "Income"
                        : transaction.kind.charAt(0).toUpperCase() +
                          transaction.kind.slice(1)}
                    </small>
                  </div>
                </div>
              </td>
              <td className="muted nowrap">
                {new Date(transaction.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </td>
              {!compact && (
                <td className="muted">
                  ••{" "}
                  {accounts
                    .find((item) => item.id === transaction.account)
                    ?.number.slice(-4)}
                </td>
              )}
              <td>
                <Status value={transaction.status} />
              </td>
              <td
                className={`amount-cell ${transaction.amount > 0 ? "positive" : ""}`}
              >
                {transaction.amount > 0 ? "+" : ""}
                {money(transaction.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function BankCard({ card, name }: { card: Card; name: string }) {
  return (
    <div className={`bank-card ${card.frozen ? "is-frozen" : ""}`}>
      <div className="row">
        <span className="card-brand">
          acme<span>.</span>
        </span>
        <span className="ml-auto small">
          {card.frozen ? "FROZEN" : "DEBIT"}
        </span>
      </div>
      <div className="row card-chip-row">
        <span className="chip" />
        <Wifi size={23} className="rotate-90" />
      </div>
      <p className="card-number">
        •••• &nbsp; •••• &nbsp; •••• &nbsp; {card.last4}
      </p>
      <div className="row">
        <span className="card-holder">{name.toUpperCase()}</span>
        <strong className="ml-auto visa">VISA</strong>
      </div>
    </div>
  );
}
export function TrustNote() {
  return (
    <div className="trust-note">
      <ShieldCheck size={16} />
      <span>Simulated banking. No real funds or payment rails.</span>
    </div>
  );
}
export function Notice({ bank }: { bank: BankContext }) {
  return (
    <>
      {bank.error && (
        <div className="alert error" role="alert">
          {bank.error}
          <button aria-label="Dismiss error" onClick={() => bank.setError("")}>
            ×
          </button>
        </div>
      )}
      {bank.notice && (
        <div className="alert success" role="status">
          <Check size={16} />
          {bank.notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => bank.setNotice("")}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
export function Shortcut({
  icon,
  title,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <Button className="shortcut" variant="outline" onClick={onClick}>
      {icon}
      <span>{title}</span>
    </Button>
  );
}
export const PendingIcon = Clock3;
export const CardIcon = CreditCard;
