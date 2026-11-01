// Privacy notice, consent items and restrictable activities. The server records every decision
// against the notice version shown, and checks it before the related processing runs.
// Bump `version` whenever a purpose, data category, recipient or retention condition changes:
// every customer is then asked again before their data is used (new purpose, new consent).

/** Optional processing that runs only with the customer's consent (withdrawable at any time). */
export const consentItems = ["notifications", "statement-archive"] as const;
export type ConsentItem = (typeof consentItems)[number];
/** Processing based on legitimate interest that the customer can object to (restriction). */
export const restrictableActivities = ["simulation"] as const;
export type RestrictableActivity = (typeof restrictableActivities)[number];

/** What a customer decided, as stored on the server with the customer record. */
export type PrivacyRecord = {
  /** Version of the privacy notice the decision refers to. */
  notice: string;
  /** Language the notice was presented in. */
  language: string;
  /** Server time of the latest decision (ISO 8601 with milliseconds). */
  decidedAt: string;
  consents: Record<ConsentItem, boolean>;
  /** Activities the customer objected to: the server refuses them for this customer. */
  restricted: RestrictableActivity[];
};

type Purpose = {
  id: "service" | ConsentItem | RestrictableActivity;
  title: string;
  basis: "Contract (required)" | "Consent (optional)" | "Legitimate interest (you can object)";
  data: string;
  why: string;
};

export const privacyNotice = {
  version: "2026-10-19",
  language: "en",
  controller: "ACME Bank (fictional banking simulation)",
  summary:
    "We use your email address, name and simulated banking records to run your simulated account. Optional uses need your consent and can be withdrawn at any time in Settings.",
  purposes: [
    {
      id: "service",
      title: "Run your simulated account",
      basis: "Contract (required)",
      data: "Email address, full name, simulated accounts, card controls, payments, beneficiaries and support requests",
      why: "Without these records there is no account to sign in to, transfer from or get support for.",
    },
    {
      id: "notifications",
      title: "Account notifications",
      basis: "Consent (optional)",
      data: "Your account activity (transfers, payments, card changes)",
      why: "Shows recent account updates in the notification panel. Off means no notification feed is built or sent to you.",
    },
    {
      id: "statement-archive",
      title: "Keep copies of exported statements",
      basis: "Consent (optional)",
      data: "Statement files (transactions of the chosen month)",
      why: "Keeps a private copy of each statement you export in ACME storage. Off means statements are only downloaded to your device.",
    },
    {
      id: "simulation",
      title: "Use my account in simulation scenarios",
      basis: "Legitimate interest (you can object)",
      data: "Your checking account, card and balance",
      why: "Administrators can run test scenarios (deposits, card purchases, pending transfers) on customer accounts. Restricting it stops them for your account.",
    },
  ] satisfies Purpose[],
  recipients:
    "Processors acting for ACME: Supabase (database, sign-in, file storage) and the web host. Support staff see your name, email, masked account numbers, balances and your support requests. Nothing is sold or used for marketing.",
  retention:
    "Account records are kept while your account exists in this simulation. The append-only audit log of account events is kept for the life of the environment. Statement copies are kept only if you allow it.",
  withdrawal:
    "Change any optional choice in Settings, under Privacy and consent. Withdrawal stops the related processing from that moment; it does not undo processing already done. Declining the notice means no account is opened.",
} as const;

export const purposeTitle = (id: string) =>
  privacyNotice.purposes.find((item) => item.id === id)?.title ?? id;

/** True when the customer decided on the current notice version (no new purpose pending). */
export const privacyCurrent = (record?: PrivacyRecord) =>
  record?.notice === privacyNotice.version;

/** Whether an optional, consent-based use of the customer's data may run. */
export const consentGiven = (record: PrivacyRecord | undefined, item: ConsentItem) =>
  privacyCurrent(record) && record!.consents[item] === true;

/** Whether an activity the customer can object to may run for this customer. */
export const activityAllowed = (
  record: PrivacyRecord | undefined,
  activity: RestrictableActivity,
) => !record?.restricted.includes(activity);

/** Human-readable list of what changed between two decisions, for the audit trail. */
export function privacyChanges(before: PrivacyRecord | undefined, after: PrivacyRecord) {
  const changes: string[] = [];
  if (before?.notice !== after.notice)
    changes.push(`Privacy notice ${after.notice} (${after.language}) accepted`);
  for (const item of consentItems)
    if (before?.consents[item] !== after.consents[item])
      changes.push(`${after.consents[item] ? "Consent granted" : "Consent withdrawn"}: ${item}`);
  for (const activity of restrictableActivities) {
    const was = before?.restricted.includes(activity) ?? false;
    const is = after.restricted.includes(activity);
    if (was !== is)
      changes.push(`${is ? "Processing restricted" : "Restriction lifted"}: ${activity}`);
  }
  return changes;
}
