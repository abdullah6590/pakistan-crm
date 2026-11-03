// src/components/shared/period-links.tsx - One-click date choices above a report or ledger (This month, Last month,
// This financial year, ...). Each is a plain link that keeps the page's other choices (report, account, location).
import Link from "next/link";
import { asOfDates, periods } from "@/lib/periods";
import { buttonVariants } from "@/components/ui/button";

export default function PeriodLinks({ path, keep, from, to, mode = "range" }: {
  path: string;
  /** Query values to carry over, e.g. { report: "daybook" } or { account: "..." } */
  keep: Record<string, string | undefined>;
  from?: string;
  to?: string;
  mode?: "range" | "asOf";
}) {
  const href = (range: { from?: string; to?: string }) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) params.set(k, v);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    return `${path}?${params.toString()}`;
  };
  const choices = mode === "range"
    ? periods().map((p) => ({ key: p.key, label: p.label, from: p.from, to: p.to }))
    : asOfDates().map((p) => ({ key: p.key, label: p.label, from: undefined, to: p.to }));
  return (
    <nav aria-label="Quick dates" className="mb-3 flex flex-wrap gap-1.5 print:hidden">
      {choices.map((c) => {
        const active = (c.from ?? "") === (mode === "range" ? from ?? "" : "") && c.to === to;
        return (
          <Link key={c.key} href={href(c)} aria-current={active ? "true" : undefined}
            className={buttonVariants({ size: "sm", variant: active ? "default" : "outline" })}>
            {c.label}
          </Link>
        );
      })}
    </nav>
  );
}
