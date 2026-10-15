"use client";
import { useState } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AccountTile, ActivityTable, Heading } from "@/components/banking";
import type { BankContext } from "@/services/use-bank";

export function Activity({
  bank,
  accountsPage = false,
}: {
  bank: BankContext;
  accountsPage?: boolean;
}) {
  const state = bank.state!;
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("all");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [month, setMonth] = useState("all");
  const [page, setPage] = useState(0);
  const filtered = state.transactions
    .filter(
      (item) =>
        (account === "all" || item.account === account) &&
        (status === "all" || item.status === status) &&
        (kind === "all" ||
          (kind === "credit" ? item.amount > 0 : item.amount < 0)) &&
        (month === "all" || item.date.startsWith(month)) &&
        item.description.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((first, second) => second.date.localeCompare(first.date));
  const months = [
    ...new Set(state.transactions.map((item) => item.date.slice(0, 7))),
  ]
    .sort()
    .reverse();
  const resetPage = () => setPage(0);
  return (
    <>
      <Heading
        eyebrow="BANKING"
        title={accountsPage ? "Your accounts" : "Account activity"}
        description={
          accountsPage
            ? "A home for your everyday money and future plans."
            : "Every movement, all in one place."
        }
      />
      {accountsPage && (
        <div className="account-grid account-page-tiles">
          {state.accounts.map((item) => (
            <AccountTile
              key={item.id}
              account={item}
              selected={account === item.id}
              onClick={() => {
                setAccount(item.id);
                resetPage();
              }}
            />
          ))}
        </div>
      )}
      <section className="section">
        <div className="section-top">
          <h2>
            {accountsPage ? "Account transactions" : "Transactions"}{" "}
            <span className="count">{filtered.length}</span>
          </h2>
        </div>
        <div className="filter-bar">
          <div className="search-input">
            <Search size={17} />
            <Input
              aria-label="Search transactions"
              placeholder="Search transactions"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
            />
          </div>
          <select
            aria-label="Filter account"
            value={account}
            onChange={(event) => {
              setAccount(event.target.value);
              resetPage();
            }}
          >
            <option value="all">All accounts</option>
            {state.accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.number.slice(-4)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              resetPage();
            }}
          >
            <option value="all">All statuses</option>
            <option value="settled">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
          <select
            aria-label="Filter direction"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              resetPage();
            }}
          >
            <option value="all">Money in & out</option>
            <option value="credit">Money in</option>
            <option value="debit">Money out</option>
          </select>
          <select
            aria-label="Filter month"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              resetPage();
            }}
          >
            <option value="all">All dates</option>
            {months.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        <ActivityTable
          transactions={filtered.slice(page * 12, page * 12 + 12)}
          accounts={state.accounts}
        />
        <div className="pagination">
          <p className="muted small">
            {filtered.length
              ? `${page * 12 + 1}–${Math.min(filtered.length, page * 12 + 12)} of ${filtered.length} transactions`
              : "0 transactions"}
          </p>
          <div className="row">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={(page + 1) * 12 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
