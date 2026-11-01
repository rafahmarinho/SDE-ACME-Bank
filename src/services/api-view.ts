import { z } from "zod";
import { visibleState, type Actor, type BankState } from "./bank";
import { restrictableActivities } from "./privacy";

// Response schema for /api/bank. Objects are parsed in Zod's default strip mode, so any field
// that is not declared here is removed before the response leaves the server.
const text = z.string();
const cents = z.number().int();
const privacy = z.object({
  notice: text,
  language: text,
  decidedAt: text,
  consents: z.object({ notifications: z.boolean(), "statement-archive": z.boolean() }),
  restricted: z.array(z.enum(restrictableActivities)),
});
const customer = z.object({
  id: text,
  name: text,
  email: text,
  role: z.enum(["customer", "support", "administrator"]),
  onboarded: z.boolean(),
  notifications: z.boolean(),
  sessionHours: z.number().int().optional(),
  // Only the customer's own view carries their privacy decisions; staff never receive them.
  privacy: privacy.optional(),
});
const account = z.object({
  id: text,
  owner: text,
  name: text,
  number: text,
  balance: cents,
});
const transaction = z.object({
  id: text,
  account: text,
  description: text,
  amount: cents,
  fee: cents,
  kind: z.enum(["transfer", "purchase", "deposit", "fee"]),
  status: z.enum(["settled", "pending", "failed"]),
  date: text,
  recipient: text.optional(),
  settlesAt: text.optional(),
  key: text.optional(),
});
const beneficiary = z.object({
  id: text,
  owner: text,
  name: text,
  account: text,
  bank: text,
});
const payment = z.object({
  id: text,
  owner: text,
  account: text,
  beneficiary: text,
  amount: cents,
  due: text,
  status: z.enum(["scheduled", "paid", "failed", "cancelled"]),
});
const card = z.object({
  id: text,
  owner: text,
  account: text,
  last4: z.string().regex(/^\d{4}$/),
  frozen: z.boolean(),
  limit: cents,
  spent: cents,
});
const ticket = z.object({
  id: text,
  owner: text,
  subject: text,
  message: text,
  status: z.enum(["open", "resolved"]),
  replies: z.array(z.object({ author: text, text, date: text })),
});
const event = z.object({ id: text, date: text, actor: text, message: text });
const base = { version: z.number().int(), clock: text };
const customerView = z.object({
  ...base,
  customers: z.array(customer).length(1),
  accounts: z.array(account),
  transactions: z.array(transaction),
  beneficiaries: z.array(beneficiary),
  payments: z.array(payment),
  cards: z.array(card),
  tickets: z.array(ticket),
  events: z.array(event),
});
const staffView = z.object({
  ...base,
  customers: z.array(customer.omit({ privacy: true })),
  accounts: z.array(account.extend({ number: z.string().regex(/^••\d{4}$/) })),
  transactions: z.array(transaction).max(0),
  beneficiaries: z.array(beneficiary).max(0),
  payments: z.array(payment).max(0),
  cards: z.array(card).max(0),
  tickets: z.array(ticket),
  events: z.array(event),
  summary: z.object({ pendingTransfers: cents, transactions: cents }),
});

/** Body returned by /api/bank: the role-filtered view, checked against the schema above. */
export function apiView(state: BankState, actor: Actor) {
  const view = visibleState(state, actor);
  if (actor.role !== "customer") return staffView.parse(view);
  const parsed = customerView.parse(view);
  const accounts = new Set(parsed.accounts.map((item) => item.id));
  const owned = [
    ...parsed.accounts,
    ...parsed.beneficiaries,
    ...parsed.payments,
    ...parsed.cards,
    ...parsed.tickets,
  ];
  if (
    parsed.customers[0].id !== actor.id ||
    owned.some((item) => item.owner !== actor.id) ||
    parsed.transactions.some((item) => !accounts.has(item.account)) ||
    parsed.events.some((item) => item.actor !== actor.id)
  )
    throw new Error("Response failed the ownership check.");
  return parsed;
}
