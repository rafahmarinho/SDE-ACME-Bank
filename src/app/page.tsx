import { connection } from "next/server";
import { BankApp } from "@/components/bank-app";

export default async function Home() {
  // Render per request so Next.js can apply the CSP nonce set by the proxy.
  await connection();
  return <BankApp />;
}
