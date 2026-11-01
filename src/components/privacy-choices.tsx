"use client";
import {
  consentItems,
  privacyNotice,
  restrictableActivities,
  type ConsentItem,
  type PrivacyRecord,
  type RestrictableActivity,
} from "@/services/privacy";

export type PrivacyDraft = Pick<PrivacyRecord, "consents" | "restricted">;
/** Nothing optional is selected until the customer opts in. */
export const emptyPrivacyDraft = (): PrivacyDraft => ({
  consents: { notifications: false, "statement-archive": false },
  restricted: [],
});
/** The decision sent to the server: always tied to the notice version and language shown. */
export const privacyDecision = (draft: PrivacyDraft) => ({
  notice: privacyNotice.version,
  language: privacyNotice.language,
  consents: { ...draft.consents },
  restricted: [...draft.restricted],
});
const purpose = (id: string) => privacyNotice.purposes.find((item) => item.id === id)!;

/** Concise summary with the full statement (purposes, data, recipients, retention, withdrawal). */
export function PrivacyNotice() {
  return (
    <div className="privacy-notice">
      <p>{privacyNotice.summary}</p>
      <details>
        <summary>Read the full privacy notice (version {privacyNotice.version})</summary>
        <dl>
          <dt>Controller</dt>
          <dd>{privacyNotice.controller}</dd>
          {privacyNotice.purposes.map((item) => (
            <div key={item.id}>
              <dt>
                {item.title} · <span className="muted">{item.basis}</span>
              </dt>
              <dd>
                Data: {item.data}. {item.why}
              </dd>
            </div>
          ))}
          <dt>Who receives it</dt>
          <dd>{privacyNotice.recipients}</dd>
          <dt>How long it is kept</dt>
          <dd>{privacyNotice.retention}</dd>
          <dt>Withdrawing consent</dt>
          <dd>{privacyNotice.withdrawal}</dd>
        </dl>
      </details>
    </div>
  );
}

/**
 * One switch per optional use of personal data, each with its reason. Consent items start
 * unselected; the restriction is an objection the customer can raise at any time.
 */
export function PrivacyChoices({
  value,
  onChange,
  optionClass = "consent-option",
}: {
  value: PrivacyDraft;
  onChange: (next: PrivacyDraft) => void;
  optionClass?: string;
}) {
  const toggleConsent = (item: ConsentItem, checked: boolean) =>
    onChange({ ...value, consents: { ...value.consents, [item]: checked } });
  const toggleRestriction = (activity: RestrictableActivity, checked: boolean) =>
    onChange({
      ...value,
      restricted: checked
        ? [...new Set([...value.restricted, activity])]
        : value.restricted.filter((item) => item !== activity),
    });
  return (
    <div className="privacy-choices">
      <p className="small">
        <strong>Required:</strong> {purpose("service").data}.{" "}
        <span className="muted">{purpose("service").why}</span>
      </p>
      {consentItems.map((item) => (
        <label key={item} className={optionClass} title={purpose(item).why}>
          <input
            type="checkbox"
            name={`consent-${item}`}
            checked={value.consents[item]}
            onChange={(event) => toggleConsent(item, event.target.checked)}
          />
          <span>
            {purpose(item).title} <em className="optional-tag">Optional</em>
            <small className="muted block">{purpose(item).why}</small>
          </span>
        </label>
      ))}
      {restrictableActivities.map((activity) => (
        <label key={activity} className={optionClass} title={purpose(activity).why}>
          <input
            type="checkbox"
            name={`restrict-${activity}`}
            checked={value.restricted.includes(activity)}
            onChange={(event) => toggleRestriction(activity, event.target.checked)}
          />
          <span>
            Restrict: {purpose(activity).title.toLowerCase()}{" "}
            <em className="optional-tag">Optional</em>
            <small className="muted block">{purpose(activity).why}</small>
          </span>
        </label>
      ))}
    </div>
  );
}
