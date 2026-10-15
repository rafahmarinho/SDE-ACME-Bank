import { jsPDF } from "jspdf";
import { supabase } from "@/database/supabase";
import { money, type Account, type Transaction } from "./bank";

export const csvCell = (value: string | number) => {
  const text = typeof value === "string"
    ? value.replace(/^[=+@\-\t\r]/, "'$&")
    : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};
export async function exportStatement(
  account: Account,
  transactions: Transaction[],
  month: string,
  format: "csv" | "pdf",
  owner: string,
) {
  const rows = transactions
    .filter(
      (item) =>
        item.account === account.id &&
        item.date.startsWith(month) &&
        item.status !== "failed",
    )
    .sort((first, second) => first.date.localeCompare(second.date));
  let blob: Blob;
  if (format === "csv") {
    const csv = [
      ["Date", "Description", "Amount (cents)", "Status"],
      ...rows.map((item) => [
        item.date.slice(0, 10),
        item.description,
        item.amount,
        item.status,
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    blob = new Blob([csv], { type: "text/csv" });
  } else {
    const pdf = new jsPDF();
    pdf.setFontSize(22);
    pdf.text("ACME Bank", 18, 22);
    pdf.setFontSize(11);
    pdf.text(`Account statement · ${month}`, 18, 32);
    pdf.text(`${account.name} · ending ${account.number.slice(-4)}`, 18, 40);
    pdf.text(
      "Simulated banking · USD · Pending entries are not settled",
      18,
      48,
    );
    let position = 62;
    for (const row of rows) {
      if (position > 275) {
        pdf.addPage();
        position = 20;
      }
      const lines = pdf.splitTextToSize(row.description, 85);
      pdf.text(row.date.slice(0, 10), 18, position);
      pdf.text(lines, 48, position);
      pdf.text(
        `${money(row.amount)} ${row.status === "pending" ? "(pending)" : ""}`,
        190,
        position,
        { align: "right" },
      );
      position += Math.max(9, lines.length * 6);
    }
    blob = pdf.output("blob");
  }
  const filename = `acme-${account.number.slice(-4)}-${month}.${format}`;
  if (supabase) {
    const path = `${owner}/${crypto.randomUUID()}/${filename}`;
    const { error } = await supabase.storage
      .from("statements")
      .upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error("Statement storage failed. Please retry.");
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
