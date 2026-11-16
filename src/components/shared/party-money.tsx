// src/components/shared/party-money.tsx - The colours of the invoice desk's payment panel on the customer and supplier
// lists (owner 2026-11-16): billed in blue, paid in green, and a balance badge that says at a glance who owes what.
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PartyMoney { billed: string; paid: string; balance: string }

/** Badge for one party's balance. `side`: a customer's positive balance is what they owe you; a supplier's is what you owe. */
export function BalanceBadge({ money, side, format }: { money: PartyMoney | null | undefined; side: "customer" | "supplier"; format: (n: number) => string }) {
  const b = Number(money?.balance ?? 0);
  if (!money || b === 0) {
    return (
      <span data-balance="settled" className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Settled
      </span>
    );
  }
  const owed = b > 0;
  return (
    <span data-balance={owed ? "owed" : "advance"}
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
        owed ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300" : "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300")}>
      {owed ? (side === "customer" ? "Owes " : "You owe ") : "Advance "}{format(Math.abs(b))}
    </span>
  );
}

/** Billed and paid with a small bar of how much of it is paid. */
export function BilledPaid({ money, format }: { money: PartyMoney | null | undefined; format: (n: number) => string }) {
  const billed = Number(money?.billed ?? 0), paid = Number(money?.paid ?? 0);
  if (!billed && !paid) return <span className="text-muted-foreground">-</span>;
  const pct = billed > 0 ? Math.min(100, Math.round((paid / billed) * 100)) : 100;
  return (
    <div className="min-w-[9rem] space-y-1">
      <div className="flex justify-between gap-3 text-xs tabular-nums">
        <span className="text-sky-700 dark:text-sky-300" title="Billed">{format(billed)}</span>
        <span className="text-emerald-700 dark:text-emerald-300" title="Paid">{format(paid)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-rose-200 dark:bg-rose-950" role="progressbar" aria-label="Paid of billed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export interface PartyTotals { owed: string; advance: string; otherOwed?: string; withBalance: number; parties: number }

/** The coloured tiles above a list: what is owed, advances, and how many have a balance. */
export function MoneyTiles({ totals, side, format }: { totals: PartyTotals; side: "customer" | "supplier"; format: (n: number) => string }) {
  const tiles = [
    { key: "owed", label: side === "customer" ? "Customers owe you" : "You owe suppliers", value: format(Number(totals.owed)),
      cls: "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100", sub: "text-rose-700 dark:text-rose-300" },
    { key: "advance", label: side === "customer" ? "Advances from customers" : "Advances paid to suppliers", value: format(Number(totals.advance)),
      cls: "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100", sub: "text-violet-700 dark:text-violet-300" },
    { key: "count", label: side === "customer" ? "Customers with a balance" : "Suppliers with a balance", value: `${totals.withBalance} of ${totals.parties}`,
      cls: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100", sub: "text-sky-700 dark:text-sky-300" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-money-tiles>
      {tiles.map((t) => (
        <div key={t.key} data-tile={t.key} className={cn("rounded-xl border px-4 py-3", t.cls)}>
          <p className={cn("text-xs font-medium uppercase tracking-wide", t.sub)}>{t.label}</p>
          <p className="text-xl font-bold tabular-nums">{t.value}</p>
          {t.key === "owed" && Number(totals.otherOwed ?? 0) > 0 && (
            <p data-other-owed className={cn("text-xs", t.sub)}>and {format(Number(totals.otherOwed))} on walk-in cash sales</p>
          )}
        </div>
      ))}
    </div>
  );
}
