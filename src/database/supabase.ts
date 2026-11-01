import {
  createClient,
  type AuthChangeEvent,
  type SupportedStorage,
} from "@supabase/supabase-js";
import { encryptedStorage } from "./secure-storage";
import { secureSupabaseUrl } from "./url";

const url = secureSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const configured = Boolean(
  url && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

// Session tokens are kept in sessionStorage, so closing the browser ends the session and there
// is no "remember me", and they are encrypted there (AES-256-GCM, key held in memory only; see
// ./secure-storage.ts). Only PKCE code verifiers (useless without the emailed one-time code) go
// to localStorage as they are, so confirmation and recovery links still work in a new tab.
const verifier = (key: string) => key.endsWith("-code-verifier");
const local = () => (typeof window === "undefined" ? undefined : window.localStorage);
const session = encryptedStorage(() =>
  typeof window === "undefined" ? undefined : window.sessionStorage,
);
export const authStorage: SupportedStorage = {
  getItem: (key) => (verifier(key) ? (local()?.getItem(key) ?? null) : session.getItem(key)),
  setItem: (key, value) =>
    verifier(key) ? local()?.setItem(key, value) : session.setItem(key, value),
  removeItem: (key) => (verifier(key) ? local()?.removeItem(key) : session.removeItem(key)),
};
export const authOptions = {
  // PKCE: links carry a one-time code bound to this browser instead of session tokens, and
  // sessions injected through the URL (implicit grant) are refused.
  flowType: "pkce",
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  storage: authStorage,
} as const;
export const supabase = configured
  ? createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: authOptions,
    })
  : null;

// Registered before the client finishes reading the URL, so a recovery link is never missed.
let recovery = false;
supabase?.auth.onAuthStateChange((event: AuthChangeEvent) => {
  if (event === "PASSWORD_RECOVERY") recovery = true;
  if (event === "SIGNED_OUT") recovery = false;
});
/** True only after Supabase verified a password-recovery link in this tab. */
export const recoveryVerified = () => recovery;
