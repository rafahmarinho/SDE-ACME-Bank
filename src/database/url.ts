/** Supabase must be reached over HTTPS; plain HTTP is accepted only for a loopback (local) stack. */
export function secureSupabaseUrl(url = "") {
  try {
    const { protocol, hostname } = new URL(url);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    return protocol === "https:" || (protocol === "http:" && loopback) ? url : "";
  } catch {
    return "";
  }
}
