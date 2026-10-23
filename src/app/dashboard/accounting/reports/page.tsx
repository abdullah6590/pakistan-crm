// src/app/dashboard/accounting/reports/page.tsx - Trial balance, stock position (E05), press reconciliation, approval queue.
import Link from "next/link";
import { redirect } from "next/navigation";
import { Scale } from "lucide-react";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { trialBalance, stockReport, pressReport, pendingApprovals, daybook, profitReport, negativeStockExceptions, kgReport, selfApprovalReport } from "@/lib/accounting/queries";
import type { PrismaClient } from "@prisma/client";
import { isAuthority, localDevice } from "@/lib/sync/local";
import { speculate } from "@/lib/sync/outbox";
import { reconcileCentral, reconcileLocal, numberingReport } from "@/lib/sync/reconcile";
import { getSetting } from "@/lib/accounting/setup";
import { DOCUMENT_TYPES, REASON_LABEL, money, qty, formatDate, printDate } from "@/lib/accounting/meta";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import PrintButton from "../print-button";

const REPORTS: Record<string, { title: string; resource: string }> = {
  "trial-balance": { title: "Trial balance", resource: "ledgers" },
  stock: { title: "Stock position", resource: "inventory" },
  press: { title: "Press reconciliation", resource: "press" },
  approvals: { title: "Waiting for approval", resource: "stockApproval" },
  "self-approvals": { title: "Own-approval overrides", resource: "stockApproval" },
  daybook: { title: "Daybook", resource: "ledgers" },
  profit: { title: "Profit", resource: "reports" },
  "negative-stock": { title: "Negative stock", resource: "inventory" },
  kg: { title: "Kg bought / sold", resource: "reports" },
  reconcile: { title: "Reconciliation", resource: "ledgers" },
  numbering: { title: "Numbering", resource: "ledgers" },
};

/** Phase 5: on a desktop or office server every report says whether it includes entries not yet synchronised. */
function withView<T>(sp: Record<string, string | undefined>, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  if (isAuthority() || sp.view !== "withPending") return fn(prisma);
  return speculate(prisma, localDevice(), (tx) => fn(tx as unknown as PrismaClient));
}

function ViewBanner({ report, sp }: { report: string; sp: Record<string, string | undefined> }) {
  if (isAuthority()) return null;
  const pending = sp.view === "withPending";
  const params = new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== undefined)) as Record<string, string>), report });
  if (pending) params.delete("view"); else params.set("view", "withPending");
  return (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 print:border-0 print:p-0">
      {pending
        ? "Showing synchronised figures PLUS entries on this computer (and the office server) that are not yet synchronised. Costs of those entries are provisional."
        : "Showing synchronised figures only. Entries made here that are still waiting to sync are not included."}{" "}
      <Link className="underline print:hidden" href={`/dashboard/accounting/reports?${params.toString()}`}>{pending ? "Show synchronised only" : "Include entries waiting to sync"}</Link>
    </div>
  );
}

function range(sp: Record<string, string | undefined>) {
  return { from: sp.from ? new Date(sp.from) : undefined, to: sp.to ? new Date(`${sp.to}T23:59:59.999Z`) : undefined };
}

function RangeForm({ report, sp, extra }: { report: string; sp: Record<string, string | undefined>; extra?: React.ReactNode }) {
  return (
    <form className="mb-3 flex flex-wrap gap-2 print:hidden">
      <input type="hidden" name="report" value={report} />
      <Input name="from" type="date" defaultValue={sp.from ?? ""} className="max-w-[11rem]" />
      <Input name="to" type="date" defaultValue={sp.to ?? ""} className="max-w-[11rem]" />
      {extra}
      <button className={buttonVariants({ variant: "outline" })} type="submit">Show</button>
    </form>
  );
}

const th = "px-2 py-1";
const cell = "border-b border-dotted border-gray-400 px-2 py-1";
const num = `${cell} text-right tabular-nums`;
const selectClass = "flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const key = sp.report ?? "trial-balance";
  const report = REPORTS[key];
  if (!report || !can(user.role, report.resource, "read")) redirect("/dashboard/accounting");
  const dateFormat = await getSetting(prisma, "DATE_FORMAT");
  const tabs = Object.entries(REPORTS).filter(([, r]) => can(user.role, r.resource, "read"));

  return (
    <div className="space-y-6">
      <PageHeader title={report.title} icon={Scale} actions={<PrintButton />} />
      <div className="flex flex-wrap gap-2 print:hidden">
        {tabs.map(([k, r]) => (
          <Link key={k} href={`/dashboard/accounting/reports?report=${k}`} className={buttonVariants({ size: "sm", variant: k === key ? "default" : "outline" })}>{r.title}</Link>
        ))}
      </div>
      <div className="rounded-lg border bg-white p-6 text-black print:border-0 print:p-0">
        <div className="mb-2 text-xs">{printDate()}</div>
        {(key === "trial-balance" || key === "stock") && <ViewBanner report={key} sp={sp} />}
        {key === "trial-balance" && <TrialBalance to={sp.to} sp={sp} />}
        {key === "stock" && <Stock location={sp.location} sp={sp} />}
        {key === "reconcile" && <Reconcile />}
        {key === "numbering" && <Numbering />}
        {key === "press" && <Press pressAccountId={sp.press} />}
        {key === "approvals" && <Approvals dateFormat={dateFormat} canApprove={can(user.role, "stockApproval", "write")} />}
        {key === "self-approvals" && <SelfApprovals sp={sp} dateFormat={dateFormat} />}
        {key === "daybook" && <Daybook sp={sp} dateFormat={dateFormat} />}
        {key === "profit" && <Profit sp={sp} />}
        {key === "negative-stock" && <NegativeStock dateFormat={dateFormat} />}
        {key === "kg" && <Kg sp={sp} />}
      </div>
    </div>
  );
}

async function TrialBalance({ to, sp }: { to?: string; sp: Record<string, string | undefined> }) {
  const tb = await withView(sp, (db) => trialBalance(db, to ? new Date(`${to}T23:59:59.999Z`) : undefined));
  return (
    <>
      <form className="mb-3 flex gap-2 print:hidden">
        <input type="hidden" name="report" value="trial-balance" />
        <Input name="to" type="date" defaultValue={to ?? ""} className="max-w-xs" />
        <button className={buttonVariants({ variant: "outline" })} type="submit">As at date</button>
      </form>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-black"><th className={`${th} text-left`}>Code</th><th className={`${th} text-left`}>Account</th><th className={`${th} text-left`}>Type</th><th className={`${th} text-right`}>Debit</th><th className={`${th} text-right`}>Credit</th></tr></thead>
        <tbody>
          {tb.rows.map((r) => (
            <tr key={r.accountId}>
              <td className={cell}>{r.code}</td>
              <td className={cell}><Link className="text-primary print:text-black" href={`/dashboard/accounting/ledger?account=${r.accountId}`}>{r.name}</Link></td>
              <td className={cell}>{(r.subType ?? r.kind).toLowerCase()}</td>
              <td className={num}>{money(r.debit)}</td>
              <td className={num}>{money(r.credit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black font-semibold">
            <td className={th} colSpan={3}>Total {tb.balanced ? "(balanced)" : "(NOT BALANCED)"}</td>
            <td className={`${th} text-right tabular-nums`}>{money(tb.debitTotal)}</td>
            <td className={`${th} text-right tabular-nums`}>{money(tb.creditTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}

async function Stock({ location, sp }: { location?: string; sp: Record<string, string | undefined> }) {
  const locations = await prisma.stockLocation.findMany({ orderBy: { code: "asc" } });
  const st = await withView(sp, (db) => stockReport(db, { locationCode: location || undefined }));
  return (
    <>
      <form className="mb-3 flex gap-2 print:hidden">
        <input type="hidden" name="report" value="stock" />
        <select name="location" defaultValue={location ?? ""} className={`${selectClass} max-w-xs`}>
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.code}>{l.name}</option>)}
        </select>
        <button className={buttonVariants({ variant: "outline" })} type="submit">Show</button>
      </form>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-black">
            <th className={`${th} text-left`}>ID</th><th className={`${th} text-left`}>Product name</th>
            <th className={`${th} text-right`}>C in Q</th><th className={`${th} text-right`}>Catan</th><th className={`${th} text-right`}>Qty</th>
            <th className={`${th} text-right`}>Total units</th><th className={`${th} text-right`}>Avg cost</th><th className={`${th} text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {st.rows.map((r) => (
            <tr key={r.componentId} className={r.negative ? "text-red-700" : ""}>
              <td className={cell}>{r.sku}</td>
              <td className={cell}>{r.name}{r.unitConfirmed ? "" : " (units unconfirmed)"}</td>
              <td className={num}>{r.packs ? qty(r.packs.perPack) : "-"}</td>
              <td className={num}>{r.packs ? `${qty(r.packs.packs)}` : "-"}</td>
              <td className={num}>{r.packs ? qty(r.packs.loose) : qty(r.onHand)}</td>
              <td className={num}>{qty(r.onHand)} {r.baseUnit}</td>
              <td className={num}>{money(r.averageCost, 4)}</td>
              <td className={num}>{r.value === null ? (r.negative ? "negative" : "n/a") : money(r.value)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black font-semibold">
            <td className={th} colSpan={7}>Total value{st.uncostedItems ? ` (${st.uncostedItems} item(s) without a cost are not valued)` : ""}</td>
            <td className={`${th} text-right tabular-nums`}>{money(st.totalValue)}</td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}

async function Press({ pressAccountId }: { pressAccountId?: string }) {
  const locations = await prisma.stockLocation.findMany({ where: { kind: "PRESS" }, include: { partyAccount: true } });
  const report = pressAccountId ? await pressReport(prisma, pressAccountId) : null;
  return (
    <>
      <form className="mb-3 flex gap-2 print:hidden">
        <input type="hidden" name="report" value="press" />
        <select name="press" defaultValue={pressAccountId ?? ""} className={`${selectClass} max-w-xs`}>
          <option value="">Choose a press</option>
          {locations.filter((l) => l.partyAccount).map((l) => <option key={l.id} value={l.partyAccount!.id}>{l.partyAccount!.name}</option>)}
        </select>
        <button className={buttonVariants({ variant: "outline" })} type="submit">Show</button>
      </form>
      {!locations.length && <p className="text-sm">No material has been sent to a press yet.</p>}
      {report && (
        <>
          <div className="mb-2 font-semibold">{report.press.name}</div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black">
                <th className={`${th} text-left`}>Material</th><th className={`${th} text-right`}>Sent</th><th className={`${th} text-right`}>Used for printing</th>
                <th className={`${th} text-right`}>Returned</th><th className={`${th} text-right`}>Waste / loss</th><th className={`${th} text-right`}>Still at press</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.componentId}>
                  <td className={cell}>{r.name}</td>
                  <td className={num}>{qty(r.dispatched)}</td><td className={num}>{qty(r.consumed)}</td><td className={num}>{qty(r.returned)}</td>
                  <td className={num}>{qty(r.lost)}</td><td className={`${num} font-semibold`}>{qty(r.heldAtPress)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs">Compare &quot;Still at press&quot; with a count at the press. Record any difference as a press loss (needs approval).</p>
        </>
      )}
    </>
  );
}

async function Approvals({ dateFormat, canApprove }: { dateFormat: string; canApprove: boolean }) {
  const docs = await pendingApprovals(prisma);
  const people = await prisma.user.findMany({ where: { id: { in: docs.map((d) => d.createdById) } }, select: { id: true, name: true } });
  return (
    <>
      {!canApprove && <p className="mb-2 text-sm">Only an administrator can approve these documents.</p>}
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-black"><th className={`${th} text-left`}>Number</th><th className={`${th} text-left`}>Type</th><th className={`${th} text-left`}>Date</th><th className={`${th} text-left`}>Reason</th><th className={`${th} text-left`}>Prepared by</th><th className={`${th} text-right`}>Lines</th></tr></thead>
        <tbody>
          {docs.length === 0 && <tr><td className={cell} colSpan={6}>Nothing is waiting for approval.</td></tr>}
          {docs.map((d) => (
            <tr key={d.id}>
              <td className={cell}><Link className="text-primary" href={`/dashboard/accounting/documents/${d.id}`}>{d.docNo}</Link></td>
              <td className={cell}>{DOCUMENT_TYPES[d.type]?.title ?? d.type}</td>
              <td className={cell}>{formatDate(d.date, dateFormat)}</td>
              <td className={cell}>{d.reason ? REASON_LABEL[d.reason] ?? d.reason : "-"}{d.partyAccount ? ` · ${d.partyAccount.name}` : ""}</td>
              <td className={cell}>{people.find((p) => p.id === d.createdById)?.name ?? "-"}</td>
              <td className={num}><Badge variant="secondary">{d.lines.length}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

async function Daybook({ sp, dateFormat }: { sp: Record<string, string | undefined>; dateFormat: string }) {
  const book = await daybook(prisma, range(sp));
  return (
    <>
      <RangeForm report="daybook" sp={sp} />
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-black"><th className={`${th} text-left`}>Date</th><th className={`${th} text-left`}>Document</th><th className={`${th} text-left`}>Account</th><th className={`${th} text-right`}>Debit</th><th className={`${th} text-right`}>Credit</th></tr></thead>
        <tbody>
          {book.rows.flatMap((r, i) => r.lines.map((l, j) => (
            <tr key={`${i}-${j}`}>
              <td className={cell}>{j === 0 ? formatDate(r.date, dateFormat) : ""}</td>
              <td className={cell}>{j === 0 ? <Link className="text-primary print:text-black" href={`/dashboard/accounting/documents/${r.documentId}`}>{r.docNo}{r.kind === "REVERSAL" ? " (reversal)" : ""}</Link> : ""}</td>
              <td className={cell}>{l.name}</td>
              <td className={num}>{money(l.debit)}</td>
              <td className={num}>{money(l.credit)}</td>
            </tr>
          )))}
        </tbody>
        <tfoot><tr className="border-t border-black font-semibold"><td className={th} colSpan={3}>Total</td><td className={`${th} text-right tabular-nums`}>{money(book.debitTotal)}</td><td className={`${th} text-right tabular-nums`}>{money(book.creditTotal)}</td></tr></tfoot>
      </table>
    </>
  );
}

async function Profit({ sp }: { sp: Record<string, string | undefined> }) {
  const by = sp.by === "document" ? "document" : "item";
  const p = await profitReport(prisma, range(sp), by);
  return (
    <>
      <RangeForm report="profit" sp={sp} extra={
        <select name="by" defaultValue={by} className={`${selectClass} max-w-[11rem]`}><option value="item">By item</option><option value="document">By document</option></select>
      } />
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-black"><th className={`${th} text-left`}>{by === "item" ? "Item" : "Document"}</th><th className={`${th} text-right`}>Sales less returns</th><th className={`${th} text-right`}>Cost</th><th className={`${th} text-right`}>Profit on costed sales</th><th className={`${th} text-left`}>Cost status</th></tr></thead>
        <tbody>
          {p.rows.map((r) => (
            <tr key={r.key}>
              <td className={cell}>{r.label}</td>
              <td className={num}>{money(r.revenue)}</td>
              <td className={num}>{money(r.cost)}</td>
              <td className={num}>{money(r.profit)}</td>
              <td className={cell}>{r.unavailableLines ? `${r.unavailableLines} line(s) without cost` : ""}{r.estimatedLines ? ` ${r.estimatedLines} estimated` : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-black font-semibold"><td className={th}>Total</td><td className={`${th} text-right tabular-nums`}>{money(p.revenue)}</td><td className={`${th} text-right tabular-nums`}>{money(p.cost)}</td><td className={`${th} text-right tabular-nums`}>{money(p.profitOnCostedSales)}</td><td className={th}>{p.revenueWithoutCost !== "0" ? `Sales without cost: ${money(p.revenueWithoutCost)}` : ""}</td></tr>
        </tfoot>
      </table>
      <p className="mt-2 text-xs">Line values before invoice rounding. Sales whose cost is unknown are excluded from profit and shown separately (OD-03).</p>
    </>
  );
}

async function SelfApprovals({ sp, dateFormat }: { sp: Record<string, string | undefined>; dateFormat: string }) {
  const r = await selfApprovalReport(prisma, range(sp));
  const override = await getSetting(prisma, "SELF_APPROVAL_OVERRIDE_USER");
  const holder = override ? (await prisma.user.findUnique({ where: { id: String(override) }, select: { name: true } }))?.name ?? "unknown user" : null;
  return (
    <>
      <RangeForm report="self-approvals" sp={sp} />
      <div className="mb-2 text-sm">
        Whoever prepares a stock issue, press loss or stock count cannot approve it. Override now: <b>{holder ? `enabled for ${holder}` : "off for everyone"}</b>.
      </div>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-black"><th className={`${th} text-left`}>Approved</th><th className={`${th} text-left`}>Document</th><th className={`${th} text-left`}>Type</th><th className={`${th} text-left`}>By (also prepared it)</th><th className={`${th} text-left`}>Reason</th></tr></thead>
        <tbody>
          {r.approvals.length === 0 && <tr><td className={cell} colSpan={5}>No document was approved by the person who prepared it.</td></tr>}
          {r.approvals.map((a, i) => (
            <tr key={i}>
              <td className={cell}>{formatDate(a.at, dateFormat)}</td>
              <td className={cell}><Link className="text-primary print:text-black" href={`/dashboard/accounting/documents/${a.documentId}`}>{a.docNo}</Link>{a.status === "CANCELLED" ? " (cancelled)" : ""}</td>
              <td className={cell}>{DOCUMENT_TYPES[a.type]?.title ?? a.type}</td>
              <td className={cell}>{a.approvedBy}</td><td className={cell}>{a.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mb-1 mt-4 font-semibold">Who may use the override: changes</div>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-black"><th className={`${th} text-left`}>When</th><th className={`${th} text-left`}>Changed by</th><th className={`${th} text-left`}>From</th><th className={`${th} text-left`}>To</th><th className={`${th} text-left`}>Reason</th></tr></thead>
        <tbody>
          {r.settingChanges.length === 0 && <tr><td className={cell} colSpan={5}>Never enabled.</td></tr>}
          {r.settingChanges.map((c, i) => (
            <tr key={i}><td className={cell}>{formatDate(c.at, dateFormat)}</td><td className={cell}>{c.changedBy}</td><td className={cell}>{c.from}</td><td className={cell}>{c.to}</td><td className={cell}>{c.reason}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

async function NegativeStock({ dateFormat }: { dateFormat: string }) {
  const ex = await negativeStockExceptions(prisma);
  return (
    <>
      <div className="mb-2 font-semibold">Items below zero now: {ex.stillNegative.length ? ex.stillNegative.map((x) => `${x.item} (${qty(x.onHand)})`).join(", ") : "none"}</div>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-black"><th className={`${th} text-left`}>Date</th><th className={`${th} text-left`}>Item</th><th className={`${th} text-left`}>Where</th><th className={`${th} text-right`}>Movement</th><th className={`${th} text-right`}>Balance after</th><th className={`${th} text-left`}>Document</th></tr></thead>
        <tbody>
          {ex.events.length === 0 && <tr><td className={cell} colSpan={6}>No movement has taken stock below zero.</td></tr>}
          {ex.events.map((e, i) => (
            <tr key={i}>
              <td className={cell}>{formatDate(e.date, dateFormat)}</td><td className={cell}>{e.item}</td><td className={cell}>{e.location}</td>
              <td className={num}>{qty(e.quantity)}</td><td className={num}>{qty(e.balanceAfter)}</td>
              <td className={cell}><Link className="text-primary print:text-black" href={`/dashboard/accounting/documents/${e.documentId}`}>{e.docNo}</Link>{e.status === "CANCELLED" ? " (cancelled)" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

async function Kg({ sp }: { sp: Record<string, string | undefined> }) {
  const side = sp.side === "purchase" ? "purchase" : "sale";
  const rows = await kgReport(prisma, range(sp), side);
  return (
    <>
      <RangeForm report="kg" sp={sp} extra={
        <select name="side" defaultValue={side} className={`${selectClass} max-w-[11rem]`}><option value="sale">Sold</option><option value="purchase">Bought</option></select>
      } />
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-black"><th className={`${th} text-left`}>Item</th><th className={`${th} text-left`}>Party</th><th className={`${th} text-right`}>Sheets</th><th className={`${th} text-right`}>Kg</th><th className={`${th} text-right`}>Amount</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td className={cell} colSpan={5}>No paper {side === "sale" ? "sold" : "bought"} in this period.</td></tr>}
          {rows.map((r, i) => (
            <tr key={i}><td className={cell}>{r.item}</td><td className={cell}>{r.party}</td><td className={num}>{qty(r.sheets)}</td><td className={num}>{money(r.kg, 3)}</td><td className={num}>{money(r.amount)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs">Kg = sheets x (X x Y x GSM / divisor) / 100, from each item&apos;s size (BR-01). Items without a size show 0 kg.</p>
    </>
  );
}

async function Reconcile() {
  const result = isAuthority() ? await reconcileCentral(prisma) : await reconcileLocal(prisma);
  const errors = result.findings.filter((f) => f.severity === "ERROR").length;
  return (
    <>
      <div className="mb-2 font-semibold">{errors ? `${errors} problem(s) need attention` : "No errors found"}{isAuthority() ? "" : " (this computer's copy and its waiting entries; the server comparison runs from the API when the server is reachable)"}</div>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-y border-black"><th className={`${th} text-left`}>Check</th><th className={`${th} text-left`}>Severity</th><th className={`${th} text-left`}>Finding</th><th className={`${th} text-left`}>Reference</th></tr></thead>
        <tbody>
          {result.findings.length === 0 && <tr><td className={cell} colSpan={4}>All checks passed: journals balance, every posting is complete, stock equals its movements, balances on documents equal the journal, and no unexplained numbering gaps.</td></tr>}
          {result.findings.map((f, i) => (
            <tr key={i} className={f.severity === "ERROR" ? "text-red-700" : ""}><td className={cell}>{f.check}</td><td className={cell}>{f.severity.toLowerCase()}</td><td className={cell}>{f.message}</td><td className={cell}>{f.ref ?? ""}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

async function Numbering() {
  const series = await numberingReport(prisma);
  return (
    <table className="w-full border-collapse text-sm">
      <thead><tr className="border-y border-black"><th className={`${th} text-left`}>Series</th><th className={`${th} text-right`}>Highest</th><th className={`${th} text-right`}>Used</th><th className={`${th} text-right`}>Cancelled (kept)</th><th className={`${th} text-left`}>Gaps</th></tr></thead>
      <tbody>
        {series.map((n) => (
          <tr key={n.series}>
            <td className={cell}>{n.series}</td><td className={num}>{n.highest}</td><td className={num}>{n.used}</td><td className={num}>{n.cancelled}</td>
            <td className={cell}>{n.gaps.length === 0 ? "none" : n.gaps.slice(0, 20).map((g) => `${g.number} (${g.reason})`).join("; ")}{n.gaps.length > 20 ? ` … ${n.gaps.length - 20} more` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
