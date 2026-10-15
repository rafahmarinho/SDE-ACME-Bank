"use client";
import { useState } from "react";
import {
  LockKeyhole,
  ShieldCheck,
  Snowflake,
  UnlockKeyhole,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BankCard, Field, Heading, Empty } from "@/components/banking";
import { money, type Card } from "@/services/bank";
import type { BankContext } from "@/services/use-bank";

function CardControls({ card, bank }: { card: Card; bank: BankContext }) {
  const [limit, setLimit] = useState(card.limit);
  return (
    <div className="card-controls">
      <div>
        <div className="section-top">
          <h3>
            <Snowflake size={17} />
            Freeze card
          </h3>
          <Button
            variant={card.frozen ? "default" : "outline"}
            disabled={bank.busy}
            onClick={() =>
              bank.act(
                {
                  type: "card",
                  id: card.id,
                  frozen: !card.frozen,
                  limit: card.limit,
                },
                card.frozen
                  ? "Card unfrozen."
                  : "Card frozen. Purchases will be declined.",
              )
            }
          >
            {card.frozen ? (
              <UnlockKeyhole size={16} />
            ) : (
              <LockKeyhole size={16} />
            )}
            {card.frozen ? "Unfreeze" : "Freeze"}
          </Button>
        </div>
        <p className="muted small">
          {card.frozen
            ? "Your card is paused. New purchases are declined."
            : "Pause new purchases without closing your account."}
        </p>
      </div>
      <hr />
      <Field label="Monthly spending limit">
        <div className="row">
          <input
            type="range"
            aria-label="Monthly spending limit"
            min="10000"
            max="1000000"
            step="10000"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          />
          <strong>{money(limit)}</strong>
        </div>
      </Field>
      <div className="row">
        <span className="muted small">
          Spent this month: {money(card.spent)}
        </span>
        <Button
          className="ml-auto"
          variant="outline"
          disabled={bank.busy || limit === card.limit}
          onClick={() =>
            bank.act(
              { type: "card", id: card.id, frozen: card.frozen, limit },
              "Spending limit updated.",
            )
          }
        >
          Save limit
        </Button>
      </div>
    </div>
  );
}
export function Cards({ bank }: { bank: BankContext }) {
  const profile = bank.state!.customers.find(
    (item) => item.id === bank.actor!.id,
  )!;
  return (
    <>
      <Heading
        eyebrow="IN YOUR POCKET"
        title="Your cards"
        description="Everyday spending. You're in control."
      />
      {bank.state!.cards.map((card) => (
        <section className="card-management" key={card.id}>
          <div>
            <BankCard card={card} name={profile.name} />
            <div className="card-detail-row">
              <span className="muted">Card type</span>
              <strong>Virtual debit</strong>
            </div>
            <div className="card-detail-row">
              <span className="muted">Account</span>
              <strong>
                ••{" "}
                {bank
                  .state!.accounts.find((item) => item.id === card.account)
                  ?.number.slice(-4)}
              </strong>
            </div>
            <div className="card-detail-row">
              <span className="muted">Status</span>
              <strong className={card.frozen ? "text-amber-700" : "positive"}>
                {card.frozen ? "Frozen" : "Active"}
              </strong>
            </div>
          </div>
          <CardControls
            key={`${card.id}-${card.limit}`}
            card={card}
            bank={bank}
          />
        </section>
      ))}
      {!bank.state!.cards.length && (
        <Empty
          title="Your card is waiting"
          description="Open a simulated account to receive your virtual debit card."
        />
      )}
      <div className="trust-note">
        <ShieldCheck size={17} />
        Only a fictional last four digits is stored. There is no real card
        number or CVV.
      </div>
    </>
  );
}
