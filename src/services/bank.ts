import { z } from "zod";
import {
  activityAllowed,
  consentGiven,
  privacyChanges,
  privacyCurrent,
  privacyNotice,
  restrictableActivities,
  type PrivacyRecord,
} from "./privacy";

// No runtime code generation: Zod must not probe `Function()`, which the strict CSP forbids.
z.config({ jitless: true });

export type Role = "customer" | "support" | "administrator";
export type Customer = {
  id: string;
  name: string;
  email: string;
  role: Role;
  onboarded: boolean;
  notifications: boolean;
  /** Maximum session length chosen in Settings (hours, at most 12). */
  sessionHours?: number;
  /** Privacy decisions (consents and restrictions) recorded by the server. Customers only. */
  privacy?: PrivacyRecord;
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
/** Role-filtered snapshot returned to clients; staff receive counts instead of ledger entries. */
export type BankView = BankState & {
  summary?: { pendingTransfers: number; transactions: number };
};
/** Business-rule violation whose message is safe to show to the caller. */
export class BankError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BankError";
    this.status = status;
  }
}

// Transaction limits in USD cents, shown to customers on the transfer and card screens.
// Transfers leaving ACME are harder to recover than transfers between ACME accounts, so
// they have a lower per-transfer ceiling; every account also has a daily outgoing ceiling.
export const limits = {
  internalTransfer: 2_500_000,
  externalTransfer: 1_000_000,
  dailyOutgoing: 2_500_000,
  cardMin: 10_000,
  cardMax: 1_000_000,
  cardStep: 10_000,
} as const;
// Bounds on what one customer can add to the singleton world document.
export const caps = {
  beneficiaries: 50,
  payments: 200,
  scheduledPayments: 50,
  tickets: 100,
  openTickets: 10,
  replies: 50,
  transactions: 100_000,
} as const;

const scripts = [
  "Latin", "Greek", "Cyrillic", "Armenian", "Hebrew", "Arabic", "Devanagari",
  "Bengali", "Gurmukhi", "Gujarati", "Tamil", "Telugu", "Kannada", "Malayalam",
  "Sinhala", "Thai", "Lao", "Tibetan", "Myanmar", "Georgian", "Hangul",
  "Ethiopic", "Cherokee", "Khmer", "Mongolian", "Hiragana", "Katakana", "Han",
].map((name) => [name, new RegExp(`\\p{Script=${name}}`, "u")] as const);
const eastAsian = new Set(["Han", "Hiragana", "Katakana", "Hangul"]);
/** Writing systems used by the letters of a value (punctuation, digits and marks are ignored). */
export function scriptsIn(value: string) {
  const found = new Set<string>();
  for (const char of value) {
    if (!/\p{L}/u.test(char) || /[\p{Script=Common}\p{Script=Inherited}]/u.test(char))
      continue;
    found.add(scripts.find(([, pattern]) => pattern.test(char))?.[0] ?? "non-Latin");
  }
  return [...found];
}
/** Non-Latin writing systems in a value, so look-alike names can be flagged when displayed. */
export const nonLatinScripts = (value: string) =>
  scriptsIn(value).filter((item) => item !== "Latin");
export function withScriptNotice(value: string) {
  const other = nonLatinScripts(value);
  return other.length ? `${value} (${other.join(", ")} characters)` : value;
}
// Refuses NUL and other control characters, bidi controls, invisible format characters,
// line/paragraph separators, unpaired surrogates and private-use characters.
function hasUnsafeChar(value: string, multiline: boolean) {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      if (!multiline) return true;
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    else if (code >= 0xd800 && code <= 0xdfff) return true;
    else if (
      /[\p{Cf}\p{Co}\p{Zl}\p{Zp}]/u.test(char) &&
      !(multiline && (code === 0x200c || code === 0x200d))
    )
      return true;
  }
  return false;
}
const unsafeMessage = "Remove control, formatting or invisible characters.";
const cleanText = (min: number, max: number, multiline = false) =>
  z
    .string()
    .max(max * 2)
    .transform((value) =>
      multiline
        ? value.normalize("NFC").replace(/\r\n?/g, "\n").trim()
        : value.normalize("NFC").trim(),
    )
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((value) => !hasUnsafeChar(value, multiline), unsafeMessage),
    );
// Names shown to other people (customers, beneficiaries, banks) are NFKC-normalized so
// compatibility look-alikes collapse to one form, and may not mix writing systems.
const nameText = z
  .string()
  .max(400)
  .transform((value) => value.normalize("NFKC").trim().replace(/ {2,}/g, " "))
  .pipe(
    z
      .string()
      .min(1)
      .max(200)
      .refine((value) => !hasUnsafeChar(value, false), unsafeMessage)
      .refine(
        (value) => /^[\p{L}\p{M}\p{N} .,'’&()/#-]+$/u.test(value) && /\p{L}/u.test(value),
        "Use letters, digits, spaces and basic punctuation only.",
      )
      .refine((value) => {
        const found = scriptsIn(value);
        return found.length <= 1 || found.every((item) => eastAsian.has(item));
      }, "Use characters from a single alphabet."),
  );
const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid identifier.");
const cents = z.number().int().positive().max(100_000_000);
// Privacy decisions always name the notice version and language they were made on.
const privacyChoice = {
  notice: z.literal(privacyNotice.version),
  language: z.literal(privacyNotice.language),
  consents: z.strictObject({
    notifications: z.boolean(),
    "statement-archive": z.boolean(),
  }),
  restricted: z
    .array(z.enum(restrictableActivities))
    .max(restrictableActivities.length)
    .refine((items) => new Set(items).size === items.length, "Duplicate restriction."),
};
const cardLimit = z
  .number()
  .int()
  .min(limits.cardMin)
  .max(limits.cardMax)
  .multipleOf(limits.cardStep);
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("transfer"),
    account: id,
    beneficiary: id,
    amount: cents,
    key: z.string().uuid(),
  }),
  z.object({
    type: z.literal("beneficiary"),
    name: nameText,
    account: z.string().regex(/^\d{8,20}$/),
    bank: nameText,
  }),
  z.object({ type: z.literal("remove-beneficiary"), id }),
  z.object({
    type: z.literal("schedule"),
    account: id,
    beneficiary: id,
    amount: cents,
    due: z.iso.date(),
  }),
  z.object({ type: z.literal("cancel-payment"), id }),
  z.object({
    type: z.literal("card"),
    id,
    frozen: z.boolean(),
    limit: cardLimit,
  }),
  z.object({
    type: z.literal("profile"),
    name: nameText,
    notifications: z.boolean(),
    sessionHours: z
      .union([z.literal(1), z.literal(4), z.literal(8), z.literal(12)])
      .optional(),
  }),
  z.object({
    type: z.literal("onboard"),
    name: nameText,
    /** Acceptance of the simulated banking terms (the contract). */
    consent: z.literal(true),
    /** Privacy consent, collected on its own form before the name is stored. */
    privacy: z.strictObject(privacyChoice),
  }),
  z.object({ type: z.literal("privacy"), ...privacyChoice }),
  z.object({
    type: z.literal("ticket"),
    subject: cleanText(1, 200),
    message: cleanText(5, 2000, true),
  }),
  z.object({
    type: z.literal("reply"),
    id,
    message: cleanText(1, 2000, true),
    resolve: z.boolean(),
  }),
  z.object({
    type: z.literal("scenario"),
    scenario: z.enum(["deposit", "purchase", "insufficient", "pending"]),
    customer: id,
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
/** Outgoing transfer volume of an account on the current simulation day. */
export function outgoingToday(state: BankState, accountId: string) {
  const day = state.clock.slice(0, 10);
  return state.transactions
    .filter(
      (item) =>
        item.account === accountId &&
        item.kind === "transfer" &&
        item.amount < 0 &&
        item.status !== "failed" &&
        item.date.slice(0, 10) === day,
    )
    .reduce((sum, item) => sum - item.amount, 0);
}
/** Per-transfer ceiling: transfers to ACME accounts allow more than transfers to other banks. */
export const transferLimit = (state: BankState, beneficiary: Beneficiary) =>
  state.accounts.some((item) => item.number === beneficiary.account)
    ? limits.internalTransfer
    : limits.externalTransfer;
const friendlyValidation = new Set([
  unsafeMessage,
  "Use letters, digits, spaces and basic punctuation only.",
  "Use characters from a single alphabet.",
]);
/** Message that is safe to show for a failed action: business rules and known input rules. */
export function errorMessage(
  problem: unknown,
  fallback = "Operation failed. Please retry.",
) {
  if (problem instanceof BankError) return problem.message;
  if (problem instanceof z.ZodError)
    return (
      problem.issues.find((issue) => friendlyValidation.has(issue.message))
        ?.message ?? "Invalid request. Check the supplied values."
    );
  return fallback;
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
// Fixture customers start with every optional use allowed, recorded against the current notice.
const fixturePrivacy = (): PrivacyRecord => ({
  notice: privacyNotice.version,
  language: privacyNotice.language,
  decidedAt: `${privacyNotice.version}T09:00:00.000Z`,
  consents: { notifications: true, "statement-archive": true },
  restricted: [],
});
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
      privacy: fixturePrivacy(),
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
export function visibleState(state: BankState, actor: Actor): BankView {
  // Staff get what their screens use: customer identities, masked accounts with balances,
  // the support queue and counts. Ledger entries, beneficiaries, payments and cards stay
  // on the server; only administrators see other people's events.
  if (actor.role !== "customer")
    return {
      version: state.version,
      clock: state.clock,
      customers: state.customers.map(
        ({ id, name, email, role, onboarded, notifications }) => ({
          id,
          name,
          email,
          role,
          onboarded,
          notifications,
        }),
      ),
      accounts: state.accounts.map(({ id, owner, name, number, balance }) => ({
        id,
        owner,
        name,
        number: `••${number.slice(-4)}`,
        balance,
      })),
      transactions: [],
      beneficiaries: [],
      payments: [],
      cards: [],
      tickets: state.tickets,
      events:
        actor.role === "administrator"
          ? state.events
          : state.events.filter((item) => item.actor === actor.id),
      summary: {
        pendingTransfers: state.transactions.filter(
          (item) => item.status === "pending",
        ).length,
        transactions: state.transactions.length,
      },
    };
  const accounts = state.accounts.filter((item) => item.owner === actor.id);
  const ids = new Set(accounts.map((item) => item.id));
  const profile = state.customers.find((item) => item.id === actor.id);
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
    // The notification feed is built only while the customer consents to notifications.
    events: consentGiven(profile?.privacy, "notifications")
      ? state.events.filter((item) => item.actor === actor.id)
      : [],
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
    if (!account) throw new BankError("Account not found or access denied.", 404);
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
      return false;
    const beneficiary = state.beneficiaries.find(
      (item) => item.id === beneficiaryId && item.owner === account.owner,
    );
    if (!beneficiary) throw new BankError("Beneficiary not found.", 404);
    if (beneficiary.account === account.number)
      throw new BankError("Choose a different destination account.");
    const ceiling = transferLimit(state, beneficiary);
    if (amount > ceiling)
      throw new BankError(
        `Transfers to this beneficiary are limited to ${money(ceiling)} each.`,
      );
    if (outgoingToday(state, account.id) + amount > limits.dailyOutgoing)
      throw new BankError(
        `This would exceed the daily transfer limit of ${money(limits.dailyOutgoing)} for this account.`,
      );
    const fee = feeFor(amount);
    if (account.balance < amount + fee)
      throw new BankError(
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
    throw new BankError("Administrator access required.", 403);
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
      "privacy",
    ].includes(action.type) &&
    actor.role !== "customer"
  )
    throw new BankError("Customer access required.", 403);
  // Account opening (terms accepted) must precede every other customer action.
  if (
    actor.role === "customer" &&
    action.type !== "onboard" &&
    !state.customers.find((item) => item.id === actor.id)?.onboarded
  )
    throw new BankError(
      "Open your account and accept the terms before using banking services.",
      403,
    );
  // No customer data is processed under a notice the customer has not seen: a new notice version
  // (new purpose) needs a fresh decision before anything else.
  if (
    actor.role === "customer" &&
    !["onboard", "privacy"].includes(action.type) &&
    !privacyCurrent(state.customers.find((item) => item.id === actor.id)?.privacy)
  )
    throw new BankError(
      "Review the privacy notice and confirm your choices before continuing.",
      403,
    );
  const decide = (choice: Omit<PrivacyRecord, "decidedAt">): PrivacyRecord => ({
    notice: choice.notice,
    language: choice.language,
    decidedAt: new Date().toISOString(),
    consents: { ...choice.consents },
    restricted: [...choice.restricted],
  });
  switch (action.type) {
    case "transfer":
      event(
        send(
          ownAccount(action.account),
          action.beneficiary,
          action.amount,
          action.key,
        )
          ? "Transfer submitted; funds reserved"
          : "Duplicate transfer request ignored",
      );
      break;
    case "beneficiary":
      if (
        state.beneficiaries.filter((item) => item.owner === actor.id).length >=
        caps.beneficiaries
      )
        throw new BankError(
          `You can save up to ${caps.beneficiaries} beneficiaries.`,
        );
      if (
        state.beneficiaries.some(
          (item) =>
            item.owner === actor.id &&
            item.account === action.account &&
            item.bank.toLowerCase() === action.bank.toLowerCase(),
        )
      )
        throw new BankError("This beneficiary is already saved.", 409);
      state.beneficiaries.push({
        id: uid(),
        owner: actor.id,
        name: action.name,
        bank: action.bank,
        account: action.account,
      });
      event("Beneficiary added");
      break;
    case "remove-beneficiary": {
      // Resolve the beneficiary for this customer first, so another customer's IDs
      // reveal nothing about their scheduled payments.
      const beneficiary = state.beneficiaries.find(
        (item) => item.id === action.id && item.owner === actor.id,
      );
      if (!beneficiary) throw new BankError("Beneficiary not found.", 404);
      if (
        state.payments.some(
          (item) =>
            item.owner === actor.id &&
            item.beneficiary === beneficiary.id &&
            item.status === "scheduled",
        )
      )
        throw new BankError(
          "Cancel scheduled payments before removing this beneficiary.",
        );
      state.beneficiaries = state.beneficiaries.filter(
        (item) => item !== beneficiary,
      );
      event("Beneficiary removed");
      break;
    }
    case "schedule": {
      ownAccount(action.account);
      const beneficiary = state.beneficiaries.find(
        (item) => item.id === action.beneficiary && item.owner === actor.id,
      );
      if (!beneficiary) throw new BankError("Beneficiary not found.", 404);
      if (action.due <= state.clock.slice(0, 10))
        throw new BankError("Choose a future payment date.");
      const ceiling = transferLimit(state, beneficiary);
      if (action.amount > ceiling)
        throw new BankError(
          `Payments to this beneficiary are limited to ${money(ceiling)} each.`,
        );
      const own = state.payments.filter((item) => item.owner === actor.id);
      if (
        own.length >= caps.payments ||
        own.filter((item) => item.status === "scheduled").length >=
          caps.scheduledPayments
      )
        throw new BankError(
          "Scheduled payment limit reached. Cancel a payment or contact support.",
        );
      state.payments.push({
        id: uid(),
        owner: actor.id,
        ...action,
        status: "scheduled",
      });
      event("Payment scheduled");
      break;
    }
    case "cancel-payment": {
      const payment = state.payments.find(
        (item) =>
          item.id === action.id &&
          item.owner === actor.id &&
          item.status === "scheduled",
      );
      if (!payment) throw new BankError("Scheduled payment not found.", 404);
      payment.status = "cancelled";
      event("Payment cancelled");
      break;
    }
    case "card": {
      const card = state.cards.find(
        (item) => item.id === action.id && item.owner === actor.id,
      );
      if (!card) throw new BankError("Card not found.", 404);
      card.frozen = action.frozen;
      card.limit = action.limit;
      event("Card controls updated");
      break;
    }
    case "profile": {
      const profile = state.customers.find((item) => item.id === actor.id);
      if (!profile) throw new BankError("Profile not found.", 404);
      profile.name = action.name;
      // For customers the notifications switch is the "notifications" consent: keep both in step.
      if (profile.privacy && profile.notifications !== action.notifications) {
        const next = decide({
          ...profile.privacy,
          consents: { ...profile.privacy.consents, notifications: action.notifications },
        });
        event(privacyChanges(profile.privacy, next).join(" · "));
        profile.privacy = next;
      }
      profile.notifications = action.notifications;
      if (action.sessionHours) profile.sessionHours = action.sessionHours;
      event("Profile updated");
      break;
    }
    case "onboard": {
      const profile = state.customers.find((item) => item.id === actor.id);
      if (!profile || profile.onboarded)
        throw new BankError("Account already opened.");
      const privacy = decide(action.privacy);
      event(privacyChanges(profile.privacy, privacy).join(" · "));
      profile.privacy = privacy;
      profile.notifications = privacy.consents.notifications;
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
    case "privacy": {
      const profile = state.customers.find((item) => item.id === actor.id)!;
      const privacy = decide(action);
      const changes = privacyChanges(profile.privacy, privacy);
      profile.privacy = privacy;
      profile.notifications = privacy.consents.notifications;
      event(changes.length ? changes.join(" · ") : "Privacy choices confirmed");
      break;
    }
    case "ticket": {
      const own = state.tickets.filter((item) => item.owner === actor.id);
      if (
        own.length >= caps.tickets ||
        own.filter((item) => item.status === "open").length >= caps.openTickets
      )
        throw new BankError(
          "Support request limit reached. Wait for an open request to be resolved.",
        );
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
    }
    case "reply": {
      const ticket = state.tickets.find(
        (item) =>
          item.id === action.id &&
          (actor.role !== "customer" || item.owner === actor.id),
      );
      if (!ticket) throw new BankError("Support request not found.", 404);
      if (action.resolve && actor.role === "customer")
        throw new BankError("Staff access required to resolve a ticket.", 403);
      if (ticket.replies.length >= caps.replies)
        throw new BankError(
          "This request reached its reply limit. Open a new request.",
        );
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
      // Customers can object to simulations on their account; the restriction is checked first.
      const target = state.customers.find((item) => item.id === action.customer);
      if (target && !activityAllowed(target.privacy, "simulation"))
        throw new BankError(
          "This customer restricted the use of their account in simulations.",
          403,
        );
      const account = state.accounts.find(
        (item) =>
          item.owner === action.customer && item.name === "Everyday checking",
      );
      if (!account) throw new BankError("Customer account not found.", 404);
      if (action.scenario === "pending") {
        const beneficiary = state.beneficiaries.find(
          (item) => item.owner === account.owner,
        );
        if (!beneficiary) throw new BankError("Add a beneficiary first.");
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
        // A reset restores fixture data, never consents: the customer's own decisions are kept.
        if (existing.privacy) {
          profile.privacy = existing.privacy;
          profile.notifications = existing.privacy.consents.notifications;
        }
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
  if (state.transactions.length > caps.transactions)
    throw new BankError(
      "The simulation reached its activity limit. An administrator must reset it.",
      409,
    );
  // One record per person: duplicates (for example from a repeated provisioning) are removed.
  const seen = new Set<string>();
  const customers = state.customers.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  if (customers.length < state.customers.length) {
    event(`Duplicate customer records removed: ${state.customers.length - customers.length}`);
    state.customers = customers;
  }
  state.version++;
  state.events = state.events.slice(0, 1000);
  return state;
}

/**
 * Copies the verified sign-in email (system of record: Supabase Auth) into the bank's customer
 * record, so both stores agree. Returns null when nothing changes or when the address already
 * belongs to another record (never creates a duplicate identity).
 */
export function syncEmail(
  original: BankState,
  actorId: string,
  email: string | undefined,
): BankState | null {
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  const profile = original.customers.find((item) => item.id === actorId);
  if (!profile || profile.email === email) return null;
  if (
    original.customers.some(
      (item) => item.id !== actorId && item.email.toLowerCase() === email.toLowerCase(),
    )
  )
    return null;
  const state = structuredClone(original);
  state.customers.find((item) => item.id === actorId)!.email = email;
  state.events.unshift({
    id: uid(),
    date: state.clock,
    actor: actorId,
    message: "Email address updated from the verified sign-in record",
  });
  state.version++;
  state.events = state.events.slice(0, 1000);
  return state;
}
