import { z } from "zod";

export type Role = "customer" | "support" | "administrator";
export type Customer = {
  id: string;
  name: string;
  email: string;
  role: Role;
  onboarded: boolean;
  notifications: boolean;
};
export type Account = {
  id: string;
  owner: string;
  name: string;
  number: string;
  balance: number;
};
export type Transaction = {
  id: string;
  account: string;
  description: string;
  amount: number;
  fee: number;
  kind: "transfer" | "purchase" | "deposit" | "fee";
  status: "settled" | "pending" | "failed";
  date: string;
  recipient?: string;
  settlesAt?: string;
  key?: string;
};
export type Beneficiary = {
  id: string;
  owner: string;
  name: string;
  account: string;
  bank: string;
};
export type Payment = {
  id: string;
  owner: string;
  account: string;
  beneficiary: string;
  amount: number;
  due: string;
  status: "scheduled" | "paid" | "failed" | "cancelled";
};
export type Card = {
  id: string;
  owner: string;
  account: string;
  last4: string;
  frozen: boolean;
  limit: number;
  spent: number;
};
export type Ticket = {
  id: string;
  owner: string;
  subject: string;
  message: string;
  status: "open" | "resolved";
  replies: { author: string; text: string; date: string }[];
};
export type BankEvent = {
  id: string;
  date: string;
  actor: string;
  message: string;
};
export type BankState = {
  version: number;
  clock: string;
  customers: Customer[];
  accounts: Account[];
  transactions: Transaction[];
  beneficiaries: Beneficiary[];
  payments: Payment[];
  cards: Card[];
  tickets: Ticket[];
  events: BankEvent[];
};
export type Actor = { id: string; role: Role };

const cents = z.number().int().positive().max(100_000_000);
const text = z.string().trim().min(1).max(200);
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("transfer"),
    account: text,
    beneficiary: text,
    amount: cents,
    key: z.string().uuid(),
  }),
  z.object({
    type: z.literal("beneficiary"),
    name: text,
    account: z.string().regex(/^\d{8,20}$/),
    bank: text,
  }),
  z.object({ type: z.literal("remove-beneficiary"), id: text }),
  z.object({
    type: z.literal("schedule"),
    account: text,
    beneficiary: text,
    amount: cents,
    due: z.iso.date(),
  }),
  z.object({ type: z.literal("cancel-payment"), id: text }),
  z.object({
    type: z.literal("card"),
    id: text,
    frozen: z.boolean(),
    limit: cents,
  }),
  z.object({
    type: z.literal("profile"),
    name: text,
    notifications: z.boolean(),
  }),
  z.object({
    type: z.literal("onboard"),
    name: text,
    consent: z.literal(true),
  }),
  z.object({
    type: z.literal("ticket"),
    subject: text,
    message: z.string().trim().min(5).max(2000),
  }),
  z.object({
    type: z.literal("reply"),
    id: text,
    message: z.string().trim().min(1).max(2000),
    resolve: z.boolean(),
  }),
  z.object({
    type: z.literal("scenario"),
    scenario: z.enum(["deposit", "purchase", "insufficient", "pending"]),
    customer: text,
  }),
  z.object({
    type: z.literal("advance"),
    days: z.number().int().min(1).max(30),
  }),
  z.object({ type: z.literal("reset") }),
]);
export type Action = z.infer<typeof actionSchema>;
export const feeFor = (amount: number) =>
  Math.max(25, Math.round(amount * 0.0025));
export const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    amount / 100,
  );
export function parseMoney(value: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a positive amount with up to two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return cents.parse(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}
const uid = () => crypto.randomUUID();
const names = [
  "Alex Morgan",
  "Jordan Lee",
  "Taylor Brooks",
  "Sam Rivera",
  "Casey Chen",
  "Jamie Parker",
];
export function seedBank(): BankState {
  const state: BankState = {
    version: 1,
    clock: "2026-10-12T10:00:00.000Z",
    customers: [],
    accounts: [],
    transactions: [],
    beneficiaries: [],
    payments: [],
    cards: [],
    tickets: [],
    events: [],
  };
  names.forEach((name, index) => {
    const owner = `customer-${index + 1}`;
    state.customers.push({
      id: owner,
      name,
      email: `${name.toLowerCase().replace(" ", ".")}@example.com`,
      role: "customer",
      onboarded: true,
      notifications: true,
    });
    state.accounts.push({
      id: `checking-${index + 1}`,
      owner,
      name: "Everyday checking",
      number: `10240000${index + 1}1`,
      balance: 500000 + index * 125000,
    });
    state.accounts.push({
      id: `savings-${index + 1}`,
      owner,
      name: "Goals savings",
      number: `10240000${index + 1}2`,
      balance: 820000 + index * 200000,
    });
    state.cards.push({
      id: `card-${index + 1}`,
      owner,
      account: `checking-${index + 1}`,
      last4: `482${index}`,
      frozen: false,
      limit: 250000,
      spent: 32450,
    });
    state.beneficiaries.push(
      {
        id: `ben-${index + 1}`,
        owner,
        name: "Jordan Lee",
        account: "1024000021",
        bank: "ACME Bank",
      },
      {
        id: `rent-${index + 1}`,
        owner,
        name: "Oakwood Apartments",
        account: "8834001009",
        bank: "Northline Bank",
      },
    );
    for (let day = 1; day <= 60; day++) {
      const deposit = day % 15 === 0;
      const amount = deposit
        ? 325000
        : -(1200 + ((day * 731 + index * 137) % 18000));
      const date = new Date(Date.UTC(2026, 7, 12 + day, 12)).toISOString();
      const account = state.accounts.find(
        (item) => item.id === `checking-${index + 1}`,
      )!;
      account.balance += amount;
      state.transactions.push({
        id: `seed-${index}-${day}`,
        account: account.id,
        description: deposit
          ? "Salary · Meridian Studio"
          : [
              "Whole Foods Market",
              "Blue Bottle Coffee",
              "City Transit",
              "Spotify",
              "Amazon",
              "Sunday brunch",
            ][day % 6],
        amount,
        fee: 0,
        kind: deposit ? "deposit" : "purchase",
        status: "settled",
        date,
      });
    }
    state.payments.push({
      id: `pay-${index + 1}`,
      owner,
      account: `checking-${index + 1}`,
      beneficiary: `rent-${index + 1}`,
      amount: 165000,
      due: "2026-10-15",
      status: "scheduled",
    });
  });
  state.customers.push(
    {
      id: "support-1",
      name: "Morgan Ellis",
      email: "support@example.com",
      role: "support",
      onboarded: true,
      notifications: true,
    },
    {
      id: "admin-1",
      name: "Riley Quinn",
      email: "admin@example.com",
      role: "administrator",
      onboarded: true,
      notifications: true,
    },
  );
  state.tickets.push({
    id: "ticket-1",
    owner: "customer-1",
    subject: "Question about my statement",
    message: "Can you help me find my September statement?",
    status: "open",
    replies: [],
  });
  state.events.push({
    id: "seed-event",
    date: state.clock,
    actor: "system",
    message: "Demo initialized · 6 customers · 360 transactions",
  });
  return state;
}
export function visibleState(state: BankState, actor: Actor): BankState {
  if (actor.role !== "customer") return state;
  const accounts = state.accounts.filter((item) => item.owner === actor.id);
  const ids = new Set(accounts.map((item) => item.id));
  return {
    ...state,
    customers: state.customers.filter((item) => item.id === actor.id),
    accounts,
    transactions: state.transactions.filter((item) => ids.has(item.account)),
    beneficiaries: state.beneficiaries.filter(
      (item) => item.owner === actor.id,
    ),
    payments: state.payments.filter((item) => item.owner === actor.id),
    cards: state.cards.filter((item) => item.owner === actor.id),
    tickets: state.tickets.filter((item) => item.owner === actor.id),
    events: state.events.filter((item) => item.actor === actor.id),
  };
}
export function executeAction(
  original: BankState,
  actor: Actor,
  input: unknown,
): BankState {
  const action = actionSchema.parse(input);
  let state = structuredClone(original);
  const ownAccount = (id: string, owner = actor.id) => {
    const account = state.accounts.find(
      (item) => item.id === id && item.owner === owner,
    );
    if (!account) throw new Error("Account not found or access denied.");
    return account;
  };
  const event = (message: string) =>
    state.events.unshift({
      id: uid(),
      date: state.clock,
      actor: actor.id,
      message,
    });
  const send = (
    account: Account,
    beneficiaryId: string,
    amount: number,
    key: string,
  ) => {
    if (
      state.transactions.some(
        (item) => item.key === key && item.account === account.id,
      )
    )
      return;
    const beneficiary = state.beneficiaries.find(
      (item) => item.id === beneficiaryId && item.owner === account.owner,
    );
    if (!beneficiary) throw new Error("Beneficiary not found.");
    if (beneficiary.account === account.number)
      throw new Error("Choose a different destination account.");
    const fee = feeFor(amount);
    if (account.balance < amount + fee)
      throw new Error(
        "Insufficient funds. Your balance must cover the amount and fee.",
      );
    account.balance -= amount + fee;
    state.transactions.unshift({
      id: uid(),
      account: account.id,
      description: `Transfer to ${beneficiary.name}`,
      amount: -amount,
      fee,
      kind: "transfer",
      status: "pending",
      date: state.clock,
      recipient: beneficiary.account,
      settlesAt: new Date(
        new Date(state.clock).getTime() + 86400000,
      ).toISOString(),
      key,
    });
    state.transactions.unshift({
      id: uid(),
      account: account.id,
      description: "Transfer fee",
      amount: -fee,
      fee: 0,
      kind: "fee",
      status: "settled",
      date: state.clock,
    });
  };
  const adminOnly = ["scenario", "advance", "reset"].includes(action.type);
  if (adminOnly && actor.role !== "administrator")
    throw new Error("Administrator access required.");
  if (
    !adminOnly &&
    [
      "transfer",
      "beneficiary",
      "remove-beneficiary",
      "schedule",
      "cancel-payment",
      "card",
      "onboard",
    ].includes(action.type) &&
    actor.role !== "customer"
  )
    throw new Error("Customer access required.");
  switch (action.type) {
    case "transfer":
      send(
        ownAccount(action.account),
        action.beneficiary,
        action.amount,
        action.key,
      );
      event("Transfer submitted; funds reserved");
      break;
    case "beneficiary":
      state.beneficiaries.push({
        id: uid(),
        owner: actor.id,
        name: action.name,
        bank: action.bank,
        account: action.account,
      });
      event("Beneficiary added");
      break;
    case "remove-beneficiary":
      if (
        state.payments.some(
          (item) =>
            item.beneficiary === action.id && item.status === "scheduled",
        )
      )
        throw new Error(
          "Cancel scheduled payments before removing this beneficiary.",
        );
      state.beneficiaries = state.beneficiaries.filter(
        (item) => !(item.id === action.id && item.owner === actor.id),
      );
      event("Beneficiary removed");
      break;
    case "schedule":
      ownAccount(action.account);
      if (
        !state.beneficiaries.some(
          (item) => item.id === action.beneficiary && item.owner === actor.id,
        )
      )
        throw new Error("Beneficiary not found.");
      if (action.due <= state.clock.slice(0, 10))
        throw new Error("Choose a future payment date.");
      state.payments.push({
        id: uid(),
        owner: actor.id,
        ...action,
        status: "scheduled",
      });
      event("Payment scheduled");
      break;
    case "cancel-payment": {
      const payment = state.payments.find(
        (item) =>
          item.id === action.id &&
          item.owner === actor.id &&
          item.status === "scheduled",
      );
      if (!payment) throw new Error("Scheduled payment not found.");
      payment.status = "cancelled";
      event("Payment cancelled");
      break;
    }
    case "card": {
      const card = state.cards.find(
        (item) => item.id === action.id && item.owner === actor.id,
      );
      if (!card) throw new Error("Card not found.");
      card.frozen = action.frozen;
      card.limit = action.limit;
      event("Card controls updated");
      break;
    }
    case "profile": {
      const profile = state.customers.find((item) => item.id === actor.id);
      if (!profile) throw new Error("Profile not found.");
      profile.name = action.name;
      profile.notifications = action.notifications;
      event("Profile updated");
      break;
    }
    case "onboard": {
      const profile = state.customers.find((item) => item.id === actor.id);
      if (!profile || profile.onboarded)
        throw new Error("Account already opened.");
      profile.name = action.name;
      profile.onboarded = true;
      const accountId = uid();
      state.accounts.push({
        id: accountId,
        owner: actor.id,
        name: "Everyday checking",
        number: `${Date.now()}${(crypto.getRandomValues(new Uint32Array(1))[0] % 10000)
          .toString()
          .padStart(4, "0")}`,
        balance: 0,
      });
      state.cards.push({
        id: uid(),
        owner: actor.id,
        account: accountId,
        last4: "1024",
        frozen: false,
        limit: 250000,
        spent: 0,
      });
      event("Simulated account opened; terms accepted");
      break;
    }
    case "ticket":
      state.tickets.push({
        id: uid(),
        owner: actor.id,
        subject: action.subject,
        message: action.message,
        status: "open",
        replies: [],
      });
      event("Support request opened");
      break;
    case "reply": {
      const ticket = state.tickets.find(
        (item) =>
          item.id === action.id &&
          (actor.role !== "customer" || item.owner === actor.id),
      );
      if (!ticket) throw new Error("Support request not found.");
      if (action.resolve && actor.role === "customer")
        throw new Error("Staff access required to resolve a ticket.");
      ticket.replies.push({
        author: actor.id,
        text: action.message,
        date: state.clock,
      });
      if (action.resolve) ticket.status = "resolved";
      event("Support request updated");
      break;
    }
    case "scenario": {
      const account = state.accounts.find(
        (item) =>
          item.owner === action.customer && item.name === "Everyday checking",
      );
      if (!account) throw new Error("Customer account not found.");
      if (action.scenario === "pending") {
        const beneficiary = state.beneficiaries.find(
          (item) => item.owner === account.owner,
        );
        if (!beneficiary) throw new Error("Add a beneficiary first.");
        send(account, beneficiary.id, 5000, uid());
      } else if (action.scenario === "deposit") {
        account.balance += 150000;
        state.transactions.unshift({
          id: uid(),
          account: account.id,
          description: "Simulated salary deposit",
          amount: 150000,
          fee: 0,
          kind: "deposit",
          status: "settled",
          date: state.clock,
        });
      } else {
        const amount =
          action.scenario === "insufficient" ? account.balance + 10000 : 4250;
        const card = state.cards.find((item) => item.account === account.id);
        const failed =
          account.balance < amount ||
          !card ||
          card.frozen ||
          card.spent + amount > card.limit;
        if (!failed) {
          account.balance -= amount;
          card!.spent += amount;
        }
        state.transactions.unshift({
          id: uid(),
          account: account.id,
          description: failed ? "Purchase declined" : "Purchase · Atlas Coffee",
          amount: -amount,
          fee: 0,
          kind: "purchase",
          status: failed ? "failed" : "settled",
          date: state.clock,
        });
      }
      event(`Scenario ${action.scenario} · ${action.customer}`);
      break;
    }
    case "advance": {
      const oldMonth = state.clock.slice(0, 7);
      state.clock = new Date(
        new Date(state.clock).getTime() + action.days * 86400000,
      ).toISOString();
      if (oldMonth !== state.clock.slice(0, 7))
        state.cards.forEach((card) => {
          card.spent = 0;
        });
      for (const payment of state.payments.filter(
        (item) =>
          item.status === "scheduled" && item.due <= state.clock.slice(0, 10),
      )) {
        try {
          send(
            ownAccount(payment.account, payment.owner),
            payment.beneficiary,
            payment.amount,
            payment.id,
          );
          payment.status = "paid";
        } catch {
          payment.status = "failed";
        }
      }
      for (const transaction of state.transactions.filter(
        (item) => item.status === "pending" && item.settlesAt! <= state.clock,
      )) {
        transaction.status = "settled";
        const recipient = state.accounts.find(
          (item) => item.number === transaction.recipient,
        );
        if (recipient) {
          recipient.balance += -transaction.amount;
          state.transactions.unshift({
            id: uid(),
            account: recipient.id,
            description: "Incoming ACME transfer",
            amount: -transaction.amount,
            fee: 0,
            kind: "transfer",
            status: "settled",
            date: state.clock,
          });
        }
      }
      event(`Simulation advanced ${action.days} day(s)`);
      break;
    }
    case "reset": {
      const fresh = seedBank();
      for (const profile of fresh.customers) {
        const existing = state.customers.find(item => item.email === profile.email);
        if (!existing) continue;
        const oldId = profile.id;
        profile.id = existing.id;
        for (const collection of [fresh.accounts, fresh.beneficiaries, fresh.cards, fresh.payments, fresh.tickets]) {
          collection.forEach(item => { if (item.owner === oldId) item.owner = existing.id; });
        }
      }
      const liveCustomers = state.customers.filter(item => !fresh.customers.some(profile => profile.id === item.id));
      fresh.customers.push(
        ...liveCustomers.map((item) => ({ ...item, onboarded: false })),
      );
      fresh.version = original.version;
      state = fresh;
      event("Simulation reset");
      break;
    }
  }
  state.version++;
  state.events = state.events.slice(0, 1000);
  return state;
}
