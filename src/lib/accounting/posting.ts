// src/lib/accounting/posting.ts - Posting service: turns documents into stock movements and balanced journals.
// Every workflow runs in one database transaction, so a document is either fully posted or not at all.
// Calculation rules live in src/lib/domain (unit-tested against the legacy U2024 data); this file only
// loads inputs, applies those rules and stores the results with an audit trail (OD-10, OD-11).
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient, LedgerAccount, AccountingDocument } from "@prisma/client";
import { Dec, dec, ZERO, add, sub, mul, div, cmp, isZero, isNegative, toPlain, toPaisa, fromPaisa, hasAtMostDecimals, roundHalfEven } from "@/lib/domain/decimal";
import { ItemUnitConfig, ItemKind, QuantityError, toBaseQuantity, unitFactor, pricePerBaseUnit } from "@/lib/domain/units";
import { priceLine, weightPerPacket, LinePricing } from "@/lib/domain/pricing";
import { receive, receiveUncosted, reverseReceipt, issue, referenceCostPerPack, CostState, CostStatus, EMPTY_COST_STATE } from "@/lib/domain/costing";
import { applyMovement, NegativeStockPolicy } from "@/lib/domain/stock";
import { documentTotal, DEFAULT_TOTAL_ROUNDING } from "@/lib/domain/rounding";
import {
  AccountRef, JournalEntry, SoldLine, accountMovement, assertBalanced,
  postSaleInvoice, postCashSale, postPurchaseInvoice, postStockIssue, postVoucher, postTransfer, postOpeningBalance, postSaleReturn, postPurchaseReturn, postStockAdjustment, ReturnedLine,
  postOpeningStock,
} from "@/lib/domain/ledger";
import { can } from "@/lib/permissions";
import { Db, MAIN_LOCATION, STOCK_ISSUE_REASONS, PRESS_LOSS_REASONS, getSetting, SettingKey } from "./setup";
import { carryToRevision, refundsFundedBy, releaseForCancelled } from "./allocations";

export type Tx = Prisma.TransactionClient;

export interface Actor {
  id: string;
  role: string;
}

export class PostingError extends Error {
  /** Extra facts for the screen, e.g. the suppliers a new one may duplicate. */
  details?: unknown;
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const DOCUMENT_SERIES: Record<string, string> = {
  PURCHASE_INVOICE: "PI",
  SALE_INVOICE: "SI",
  CASH_SALE: "CS",
  STOCK_ISSUE: "SIS",
  PRESS_DISPATCH: "PD",
  PRESS_RECEIPT: "PR",
  PRESS_RETURN: "PRT",
  PRESS_LOSS: "PL",
  SALE_RETURN: "SR",
  PURCHASE_RETURN: "PRN",
  STOCK_ADJUSTMENT: "SADJ",
  OPENING_STOCK: "OS",
  TRANSFER: "TR",
  OPENING_BALANCE: "OB",
};

/** F-04: receipt and payment vouchers are numbered separately for cash and bank. */
export const VOUCHER_SERIES = ["CRV", "BRV", "CPV", "BPV", "JV"] as const;
export type VoucherSeries = (typeof VOUCHER_SERIES)[number];

// ─── Inputs ────────────────────────────────────────────────────────

export interface ItemLineInput {
  componentId: string;
  quantity: number | string;
  /** Unit of `quantity` (a configured pack unit or the base unit; default: base unit). */
  unit?: string;
  /** Loose base units with a pack unit (legacy "Qty"). */
  loose?: number | string;
  /** Price per `unit`; required on sale and purchase documents. */
  unitPrice?: number | string;
  description?: string;
}

export interface SaleInvoiceInput {
  date: Date | string;
  partyAccountId: string;
  lines: ItemLineInput[];
  remarks?: string;
}

export interface CashSaleInput {
  date: Date | string;
  cashAccountId: string;
  /** Defaults to the full total. Any unpaid remainder is charged to `partyAccountId` or Counter Sale (F-03). */
  amountReceived?: number | string;
  partyAccountId?: string;
  customerName?: string;
  lines: ItemLineInput[];
  remarks?: string;
}

export interface PurchaseInvoiceInput {
  date: Date | string;
  partyAccountId: string;
  lines: ItemLineInput[];
  vendorBillNo?: string;
  vendorBillDate?: Date | string | null;
  biltyNo?: string;
  biltyDate?: Date | string | null;
  /** When the supplier is to be paid (payment terms); optional (Report 30). */
  dueDate?: Date | string | null;
  /** Freight, loading, bilty and similar charges: recorded only (2026-10-22 rule). */
  charges?: ChargeInput[];
  remarks?: string;
}

export interface StockIssueInput {
  date: Date | string;
  reason: (typeof STOCK_ISSUE_REASONS)[number];
  /** Account charged with the cost; defaults to the account configured for the reason. */
  counterAccountId?: string;
  lines: ItemLineInput[];
  remarks: string;
}

export interface PressMovementInput {
  date: Date | string;
  pressAccountId: string;
  lines: ItemLineInput[];
  remarks?: string;
}

export interface PressReceiptLineInput extends ItemLineInput {
  /** Material held at the press that was used for this line. */
  consumedComponentId: string;
  consumedQuantity: number | string;
  consumedUnit?: string;
  consumedLoose?: number | string;
}

export interface PressReceiptInput {
  date: Date | string;
  pressAccountId: string;
  lines: PressReceiptLineInput[];
  /** Printing charges billed by the press: recorded only, never added to cost or posted (2026-10-22 rule). */
  charges?: ChargeInput[];
  remarks?: string;
}

export const CHARGE_KINDS = ["FREIGHT", "LOADING", "BILTY", "OTHER_PURCHASE", "PRINTING"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

/** A purchase-related or printing charge. Recording it creates no journal, stock value or balance change. */
export interface ChargeInput {
  kind: ChargeKind;
  amount: number | string;
  description: string;
  date?: Date | string;
  /** Supplier, press or transporter; defaults to the document's party. */
  partyAccountId?: string;
  reference?: string;
}

export interface PressLossInput extends PressMovementInput {
  reason: (typeof PRESS_LOSS_REASONS)[number];
  remarks: string;
}

export interface ReturnLineInput {
  /** Line number on the original document. */
  lineNo: number;
  quantity: number | string;
  unit?: string;
  loose?: number | string;
}

export interface SaleReturnInput {
  date: Date | string;
  originalDocumentId: string;
  /** Refund paid from this cash/bank account; otherwise the original customer is credited. */
  refundAccountId?: string;
  lines: ReturnLineInput[];
  remarks?: string;
}

export interface PurchaseReturnInput {
  date: Date | string;
  originalDocumentId: string;
  lines: ReturnLineInput[];
  remarks?: string;
}

/** Physical count of items in the main store; differences post only after approval (D-09). */
export interface StockAdjustmentInput {
  date: Date | string;
  lines: ItemLineInput[];
  remarks: string;
}

export interface VoucherInput {
  series: VoucherSeries;
  date: Date | string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number | string;
  remarks?: string;
}

export interface TransferInput {
  date: Date | string;
  fromAccountId: string;
  toAccountId: string;
  amount: number | string;
  remarks?: string;
}

/** Stock already on hand when Books starts (Report 28 §6), at cost per base unit. */
export interface OpeningStockInput {
  date: Date | string;
  /** `unitCost` is the cost of one `unit` (a configured pack unit or the base unit; default: base unit). */
  lines: { componentId: string; quantity: number | string; unit?: string; loose?: number | string; unitCost: number | string }[];
  remarks?: string;
}

export interface OpeningBalanceInput {
  date: Date | string;
  accountId: string;
  debit?: number | string;
  credit?: number | string;
  remarks?: string;
}

// ─── Small helpers ─────────────────────────────────────────────────

const s = toPlain;

export function toDate(v: Date | string, label = "Date"): Date {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new PostingError(`${label} is not a valid date`);
  return d;
}

/** F-07: blank optional dates are stored as null, never as a placeholder date. */
function optionalDate(v: Date | string | null | undefined, label: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  return toDate(v, label);
}

export function money(v: number | string | undefined, label: string): Dec {
  let d: Dec;
  try {
    d = dec(v ?? "");
  } catch {
    throw new PostingError(`${label} is not a valid amount`);
  }
  if (isNegative(d)) throw new PostingError(`${label} cannot be negative`);
  if (!hasAtMostDecimals(d, 2)) throw new PostingError(`${label} allows at most 2 decimal places`);
  return d;
}

export function jsonSafe(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

export async function audit(tx: Tx, entityId: string, action: string, userId: string, extra: { reason?: string; before?: unknown; after?: unknown } = {}) {
  await tx.auditLog.create({
    data: {
      entity: "AccountingDocument",
      entityId,
      action,
      userId,
      reason: extra.reason,
      before: extra.before === undefined ? null : jsonSafe(extra.before),
      after: extra.after === undefined ? null : jsonSafe(extra.after),
    },
  });
}

export async function nextNumber(tx: Tx, series: string): Promise<number> {
  const row = await tx.documentSeries.upsert({
    where: { series },
    create: { series, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
  });
  return row.nextNumber - 1;
}

type NewDocument = Omit<Prisma.AccountingDocumentUncheckedCreateInput, "series" | "number" | "docNo" | "revision">;

/**
 * An official number assigned in advance by an office server from a block the cloud reserved for it (Report 21
 * §12). Set only by the sync executor after validating the block; ordinary entries take the next number.
 */
const assignedNumber = new AsyncLocalStorage<{ series: string; number: number }>();
export function withAssignedNumber<T>(series: string, number: number, fn: () => Promise<T>): Promise<T> {
  return assignedNumber.run({ series, number }, fn);
}

export async function newDocument(tx: Tx, data: NewDocument, opts: { series?: string; supersedes?: AccountingDocument } = {}) {
  if (opts.supersedes) {
    const old = opts.supersedes;
    const revision = old.revision + 1;
    return tx.accountingDocument.create({
      data: { ...data, series: old.series, number: old.number, revision, docNo: `${old.series}-${String(old.number).padStart(4, "0")}/R${revision}`, supersedesId: old.id },
    });
  }
  const series = opts.series ?? DOCUMENT_SERIES[data.type];
  const preset = assignedNumber.getStore();
  const number = preset && preset.series === series ? preset.number : await nextNumber(tx, series);
  return tx.accountingDocument.create({ data: { ...data, series, number, docNo: `${series}-${String(number).padStart(4, "0")}` } });
}

export async function getAccount(tx: Tx, id: string | undefined | null, kinds: string[], label: string): Promise<LedgerAccount> {
  if (!id) throw new PostingError(`${label} is required`);
  const a = await tx.ledgerAccount.findUnique({ where: { id } });
  if (!a) throw new PostingError(`${label} not found`, 404);
  if (!a.isActive) throw new PostingError(`${label} "${a.name}" is inactive`);
  if (kinds.length && !kinds.includes(a.kind)) throw new PostingError(`${label} "${a.name}" is not a ${kinds.join(" or ").toLowerCase().replace("_", "/")} account`);
  return a;
}

export async function accountByCode(tx: Tx, code: string): Promise<LedgerAccount> {
  const a = await tx.ledgerAccount.findUnique({ where: { code } });
  if (!a) throw new PostingError(`System account ${code} is missing; run the accounting setup`, 500);
  return a;
}

export function refFor(a: LedgerAccount): AccountRef {
  return a.kind === "GL" ? { type: "GL", id: a.code } : { type: a.kind as AccountRef["type"], id: a.id };
}

async function resolveRef(tx: Tx, ref: AccountRef): Promise<string> {
  return ref.type === "GL" ? (await accountByCode(tx, ref.id)).id : ref.id;
}

async function locationByCode(tx: Tx, code: string) {
  const l = await tx.stockLocation.findUnique({ where: { code } });
  if (!l) throw new PostingError(`Stock location ${code} is missing; run the accounting setup`, 500);
  return l;
}

async function pressLocation(tx: Tx, press: LedgerAccount) {
  const code = `PRESS-${press.code}`;
  return tx.stockLocation.upsert({
    where: { code },
    create: { code, name: `Held at press: ${press.name}`, kind: "PRESS", partyAccountId: press.id },
    update: {},
  });
}

function requireLines<T>(lines: T[] | undefined): T[] {
  if (!lines || lines.length === 0) throw new PostingError("Add at least one line");
  return lines;
}

// ─── Items and units ───────────────────────────────────────────────

export interface ItemContext {
  componentId: string;
  name: string;
  cfg: ItemUnitConfig;
  unitConfirmed: boolean;
  /** F-02 reference cost per base unit, used only when no purchase cost was recorded. */
  refCostPerBase: Dec | null;
}

type ComponentWithProfile = Prisma.ComponentGetPayload<{ include: { unitProfile: { include: { conversions: true } } } }>;
/** The item fields its units are worked out from. */
export type UnitSource = Pick<ComponentWithProfile, "unit" | "rimInSheet" | "itemsPerPackage" | "packagingUnit" | "unitProfile">;

/** Until an item's units are confirmed (Report 13 D-C), derive them from the existing item fields. */
function fallbackUnitConfig(c: UnitSource): ItemUnitConfig {
  const unit = (c.unit || "piece").toLowerCase();
  if (unit === "sheet") return { kind: "PAPER", baseUnit: "sheet", conversions: [{ code: "packet", factor: c.rimInSheet && c.rimInSheet > 0 ? c.rimInSheet : 100 }] };
  if (unit === "kg") return { kind: "WEIGHT", baseUnit: "kg", baseDecimals: 3 };
  const conversions = c.itemsPerPackage > 1 && c.packagingUnit ? [{ code: c.packagingUnit.toLowerCase(), factor: c.itemsPerPackage }] : [];
  return { kind: "PIECE", baseUnit: unit, conversions };
}

function referenceCost(c: ComponentWithProfile, cfg: ItemUnitConfig): Dec | null {
  const p = c.unitProfile;
  if (!p || p.referencePurchasePrice === null) return null;
  const packUnit = cfg.purchaseUnit ?? (cfg.kind === "PAPER" ? cfg.conversions?.[0]?.code : undefined);
  const factor = unitFactor(cfg, packUnit);
  let perPack: Dec | null;
  if (cfg.kind === "PAPER") {
    const weight = weightPerPacket({ x: c.dimensionX ?? 0, y: c.dimensionY ?? 0, gsm: c.gsm ?? 0, divisor: c.divisor ?? undefined }, Number(toPlain(factor)));
    if (isZero(weight)) return null; // no dimensions: do not invent a cost
    perPack = referenceCostPerPack({ kind: "PAPER", packetWeightKg: weight, ratePerKg: p.referencePurchasePrice, expensePerKg: p.referenceExpenses });
  } else {
    perPack = referenceCostPerPack({ kind: "OTHER", purchasePrice: p.referencePurchasePrice, expenses: p.referenceExpenses });
  }
  return perPack === null ? null : div(perPack, factor);
}

export function unitConfigFor(c: UnitSource): { cfg: ItemUnitConfig; confirmed: boolean } {
  const p = c.unitProfile;
  if (!p) return { cfg: fallbackUnitConfig(c), confirmed: false };
  return {
    cfg: {
      kind: p.kind as ItemKind,
      baseUnit: p.baseUnit,
      baseDecimals: p.baseDecimals,
      conversions: p.conversions.map((x) => ({ code: x.code, factor: x.factor, decimals: x.decimals })),
      purchaseUnit: p.purchaseUnit ?? undefined,
      saleUnit: p.saleUnit ?? undefined,
      confirmed: p.confirmed,
    },
    confirmed: p.confirmed,
  };
}

async function loadItem(tx: Tx, componentId: string): Promise<ItemContext> {
  const c = await tx.component.findUnique({ where: { id: componentId }, include: { unitProfile: { include: { conversions: true } } } });
  if (!c) throw new PostingError("Item not found", 404);
  const { cfg, confirmed } = unitConfigFor(c);
  let refCostPerBase: Dec | null = null;
  try {
    refCostPerBase = referenceCost(c, cfg);
  } catch (e) {
    throw new PostingError(`${c.name}: ${(e as Error).message}`);
  }
  return { componentId: c.id, name: c.name, cfg, unitConfirmed: confirmed, refCostPerBase };
}

function baseQuantityOf(item: ItemContext, l: { quantity: number | string; unit?: string; loose?: number | string }): Dec {
  try {
    const q = toBaseQuantity(item.cfg, { quantity: l.quantity, unit: l.unit, loose: l.loose });
    if (isZero(q)) throw new QuantityError("Quantity must be more than zero");
    return q;
  } catch (e) {
    if (e instanceof QuantityError || e instanceof Error) throw new PostingError(`${item.name}: ${e.message}`);
    throw e;
  }
}

function priced(item: ItemContext, l: ItemLineInput): LinePricing {
  if (l.unitPrice === undefined || l.unitPrice === "") throw new PostingError(`${item.name}: price is required`);
  baseQuantityOf(item, l);
  try {
    return priceLine({ unit: item.cfg, quantity: { quantity: l.quantity, unit: l.unit, loose: l.loose }, unitPrice: l.unitPrice });
  } catch (e) {
    throw new PostingError(`${item.name}: ${(e as Error).message}`);
  }
}

// ─── Stock ─────────────────────────────────────────────────────────

interface PostCtx {
  tx: Tx;
  documentId: string;
  date: Date;
  policy: NegativeStockPolicy;
  negative: boolean;
  costEstimated: boolean;
  /** For the item's Inventory history: which document moved the stock, and who made it */
  ref: StockRef;
}

async function costState(tx: Tx, componentId: string): Promise<CostState> {
  const row = await tx.itemCostState.findUnique({ where: { componentId } });
  if (!row) return EMPTY_COST_STATE;
  return { onHand: dec(row.onHand), averageCost: row.averageCost === null ? null : dec(row.averageCost) };
}

async function saveCostState(tx: Tx, componentId: string, st: CostState) {
  const data = { onHand: s(st.onHand), averageCost: st.averageCost === null ? null : s(st.averageCost) };
  await tx.itemCostState.upsert({ where: { componentId }, create: { componentId, ...data }, update: data });
}

async function locationBalance(tx: Tx, componentId: string, locationId: string): Promise<Dec> {
  const row = await tx.itemStockBalance.findUnique({ where: { componentId_locationId: { componentId, locationId } } });
  return row ? dec(row.onHand) : ZERO;
}

/**
 * Opening stock for items whose count already includes it (the one-time move of existing stock into Books) must not
 * be added to the count a second time.
 */
const countAlreadyIncludes = new AsyncLocalStorage<true>();
export function withoutItemCountChange<T>(fn: () => Promise<T>): Promise<T> {
  return countAlreadyIncludes.run(true, fn);
}

interface StockRef { docNo: string; userId: string; note?: string }

async function saveLocationBalance(tx: Tx, componentId: string, locationId: string, onHand: Dec, ref?: StockRef) {
  // The item's stock count on the Inventory and Sales screens moves with Books' main store, by the same change. It is
  // never overwritten, so stock still entered outside Books (older screens) is kept (Report 28 §6).
  if (!countAlreadyIncludes.getStore()) {
    const location = await tx.stockLocation.findUnique({ where: { id: locationId }, select: { code: true } });
    if (location?.code === MAIN_LOCATION) {
      // The count holds whole numbers: it moves by the change in the rounded balance, so small kg movements never
      // add up to a drift (0.4 kg sold three times moves it by 1, not by 0)
      const before = await locationBalance(tx, componentId, locationId);
      const whole = Math.round(Number(s(onHand))) - Math.round(Number(s(before)));
      if (whole !== 0) {
        const c = await tx.component.update({ where: { id: componentId }, data: { quantity: { increment: whole } } });
        // The item's Inventory history shows every Books movement too, so stock reports agree with Books
        if (ref) {
          await tx.inventoryHistory.create({
            data: { componentId, type: whole > 0 ? "ADD" : "REMOVE", quantity: Math.abs(whole), balanceAfter: c.quantity, reference: `Books ${ref.docNo}${ref.note ? ` ${ref.note}` : ""}`, performedBy: ref.userId },
          });
        }
      }
    }
  }
  await tx.itemStockBalance.upsert({
    where: { componentId_locationId: { componentId, locationId } },
    create: { componentId, locationId, onHand: s(onHand) },
    update: { onHand: s(onHand) },
  });
}

/** Take stock out of a location under the negative-stock policy (OD-04); returns the new balance and any warning. */
async function takeFromLocation(ctx: PostCtx, item: ItemContext, locationId: string, qty: Dec) {
  const before = await locationBalance(ctx.tx, item.componentId, locationId);
  const m = applyMovement(before, sub(ZERO, qty), ctx.policy);
  if (!m.allowed) {
    throw new PostingError(`Not enough stock of ${item.name}: ${s(before)} ${item.cfg.baseUnit} available, ${s(qty)} needed (negative stock is blocked)`, 409);
  }
  await saveLocationBalance(ctx.tx, item.componentId, locationId, m.balanceAfter, ctx.ref);
  if (m.warning) ctx.negative = true;
  return { balanceAfter: m.balanceAfter, warning: m.warning ? `${item.name}: ${m.warning.message} (${s(m.balanceAfter)} ${item.cfg.baseUnit})` : undefined };
}

async function stockIn(ctx: PostCtx, item: ItemContext, a: { lineNo?: number; locationId: string; qty: Dec; value: Dec | null; kind?: string }) {
  const st = await costState(ctx.tx, item.componentId);
  const next = a.value === null ? receiveUncosted(st, a.qty) : receive(st, a.qty, div(a.value, a.qty));
  await saveCostState(ctx.tx, item.componentId, next);
  const balanceAfter = add(await locationBalance(ctx.tx, item.componentId, a.locationId), a.qty);
  await saveLocationBalance(ctx.tx, item.componentId, a.locationId, balanceAfter, ctx.ref);
  if (a.value === null) ctx.costEstimated = true;
  await ctx.tx.stockMovement.create({
    data: {
      documentId: ctx.documentId, lineNo: a.lineNo, componentId: item.componentId, locationId: a.locationId, date: ctx.date,
      kind: a.kind ?? "RECEIPT", quantity: s(a.qty), balanceAfter: s(balanceAfter),
      costAmount: a.value === null ? null : s(a.value), costStatus: a.value === null ? "UNAVAILABLE" : "ACTUAL",
    },
  });
}

async function stockOut(ctx: PostCtx, item: ItemContext, a: { lineNo?: number; locationId: string; qty: Dec }) {
  const taken = await takeFromLocation(ctx, item, a.locationId, a.qty);
  const r = issue(await costState(ctx.tx, item.componentId), a.qty, item.refCostPerBase);
  await saveCostState(ctx.tx, item.componentId, r.state);
  if (r.status !== "ACTUAL") ctx.costEstimated = true;
  await ctx.tx.stockMovement.create({
    data: {
      documentId: ctx.documentId, lineNo: a.lineNo, componentId: item.componentId, locationId: a.locationId, date: ctx.date,
      kind: "ISSUE", quantity: s(sub(ZERO, a.qty)), balanceAfter: s(taken.balanceAfter),
      costAmount: r.cost === null ? null : s(sub(ZERO, r.cost)), costStatus: r.status, warning: taken.warning,
    },
  });
  return { cost: r.cost, status: r.status, note: r.note, warning: taken.warning };
}

/** Take stock out at a known value (purchase return): the value it arrived with leaves the average. */
async function stockOutAtValue(ctx: PostCtx, item: ItemContext, a: { lineNo?: number; locationId: string; qty: Dec; value: Dec }) {
  const taken = await takeFromLocation(ctx, item, a.locationId, a.qty);
  await saveCostState(ctx.tx, item.componentId, reverseReceipt(await costState(ctx.tx, item.componentId), a.qty, a.value));
  await ctx.tx.stockMovement.create({
    data: {
      documentId: ctx.documentId, lineNo: a.lineNo, componentId: item.componentId, locationId: a.locationId, date: ctx.date,
      kind: "ISSUE", quantity: s(sub(ZERO, a.qty)), balanceAfter: s(taken.balanceAfter), costAmount: s(sub(ZERO, a.value)), costStatus: "ACTUAL", warning: taken.warning,
    },
  });
  return { warning: taken.warning };
}

/** Move stock between locations (store <-> press). Ownership and value do not change. */
async function relocate(ctx: PostCtx, item: ItemContext, a: { lineNo: number; fromId: string; toId: string; qty: Dec }) {
  const taken = await takeFromLocation(ctx, item, a.fromId, a.qty);
  const toAfter = add(await locationBalance(ctx.tx, item.componentId, a.toId), a.qty);
  await saveLocationBalance(ctx.tx, item.componentId, a.toId, toAfter, ctx.ref);
  const st = await costState(ctx.tx, item.componentId);
  const value = st.averageCost === null ? null : mul(a.qty, st.averageCost);
  const status: CostStatus = value === null ? "UNAVAILABLE" : "ACTUAL";
  await ctx.tx.stockMovement.createMany({
    data: [
      { documentId: ctx.documentId, lineNo: a.lineNo, componentId: item.componentId, locationId: a.fromId, date: ctx.date, kind: "RELOCATE", quantity: s(sub(ZERO, a.qty)), balanceAfter: s(taken.balanceAfter), costAmount: value === null ? null : s(sub(ZERO, value)), costStatus: status, warning: taken.warning },
      { documentId: ctx.documentId, lineNo: a.lineNo, componentId: item.componentId, locationId: a.toId, date: ctx.date, kind: "RELOCATE", quantity: s(a.qty), balanceAfter: s(toAfter), costAmount: value === null ? null : s(value), costStatus: status },
    ],
  });
  return { warning: taken.warning };
}

export async function newCtx(tx: Tx, documentId: string, date: Date): Promise<PostCtx> {
  const doc = await tx.accountingDocument.findUnique({ where: { id: documentId }, select: { docNo: true, createdById: true } });
  return {
    tx, documentId, date, policy: await getSetting(tx, "NEGATIVE_STOCK_POLICY"), negative: false, costEstimated: false,
    ref: { docNo: doc?.docNo ?? documentId, userId: doc?.createdById ?? "system" },
  };
}

// ─── Journal and balances ──────────────────────────────────────────

async function writeJournal(tx: Tx, documentId: string, date: Date, entry: JournalEntry, userId: string, kind = "POSTING") {
  assertBalanced(entry);
  if (entry.lines.length === 0) return null;
  const lines = [];
  for (const l of entry.lines) {
    lines.push({ accountId: await resolveRef(tx, l.account), debitPaisa: toPaisa(l.debit), creditPaisa: toPaisa(l.credit), memo: l.memo });
  }
  return tx.journalEntry.create({ data: { documentId, date, kind, createdById: userId, lines: { create: lines } } });
}

/** Signed balance (debit positive) of an account from posted journals, optionally up to a date. */
export async function accountBalance(db: Db, accountId: string, opts: { upTo?: Date; before?: Date } = {}): Promise<Dec> {
  const date = opts.upTo ? { lte: opts.upTo } : opts.before ? { lt: opts.before } : undefined;
  const agg = await db.journalLine.aggregate({
    where: { accountId, ...(date ? { entry: { date } } : {}) },
    _sum: { debitPaisa: true, creditPaisa: true },
  });
  return fromPaisa((agg._sum.debitPaisa ?? BigInt(0)) - (agg._sum.creditPaisa ?? BigInt(0)));
}

/** Write the journal, the OD-09 balance snapshot and the document totals, then audit the posting. */
export async function finishPosting(
  tx: Tx, ctx: PostCtx, doc: AccountingDocument, entry: JournalEntry, actor: Actor,
  opts: { party?: LedgerAccount | null; total?: { exact: Dec; total: Dec; roundingAdjustment: Dec }; extra?: Prisma.AccountingDocumentUncheckedUpdateInput } = {}
) {
  let previousBalance: string | null = null;
  let newBalance: string | null = null;
  if (opts.party) {
    const prev = await accountBalance(tx, opts.party.id, { upTo: doc.date });
    previousBalance = s(prev);
    newBalance = s(add(prev, accountMovement(entry, refFor(opts.party))));
  }
  await writeJournal(tx, doc.id, doc.date, entry, actor.id);
  const updated = await tx.accountingDocument.update({
    where: { id: doc.id },
    data: {
      ...(opts.total ? { exactTotal: s(opts.total.exact), total: s(opts.total.total), roundingAdjustment: s(opts.total.roundingAdjustment) } : {}),
      previousBalance, newBalance,
      hasCostEstimate: ctx.costEstimated || (entry.costFlags ?? []).length > 0,
      hasNegativeStock: ctx.negative,
      ...opts.extra,
    },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  await audit(tx, doc.id, "POST", actor.id, { after: { docNo: updated.docNo, total: updated.total, journal: entry.lines.map((l) => ({ ...l.account, debit: s(l.debit), credit: s(l.credit) })) } });
  return updated;
}

function lineRecord(documentId: string, lineNo: number, item: ItemContext, l: ItemLineInput, baseQuantity: Dec, extra: Partial<Prisma.AccountingDocumentLineUncheckedCreateInput> = {}): Prisma.AccountingDocumentLineUncheckedCreateInput {
  return {
    documentId, lineNo, componentId: item.componentId, description: l.description ?? item.name,
    quantity: s(dec(l.quantity)), unit: l.unit ?? item.cfg.baseUnit,
    loose: l.loose === undefined || l.loose === "" ? "0" : s(dec(l.loose)), baseQuantity: s(baseQuantity),
    ...extra,
  };
}

// ─── Sales and purchases ───────────────────────────────────────────

async function saleInvoiceInTx(tx: Tx, actor: Actor, input: SaleInvoiceInput, supersedes?: AccountingDocument) {
  const lines = requireLines(input.lines);
  const party = await getAccount(tx, input.partyAccountId, ["PARTY"], "Customer account");
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const doc = await newDocument(tx, {
    type: "SALE_INVOICE", date, status: "POSTED", partyAccountId: party.id, locationId: main.id,
    roundingMode: DEFAULT_TOTAL_ROUNDING.SALE_INVOICE, remarks: input.remarks, createdById: actor.id, postedAt: new Date(),
  }, { supersedes });
  const ctx = await newCtx(tx, doc.id, date);
  const sold: SoldLine[] = [];
  for (const [i, l] of lines.entries()) {
    const item = await loadItem(tx, l.componentId);
    const p = priced(item, l);
    const out = await stockOut(ctx, item, { lineNo: i + 1, locationId: main.id, qty: p.baseQuantity });
    await tx.accountingDocumentLine.create({
      data: lineRecord(doc.id, i + 1, item, l, p.baseQuantity, {
        unitPrice: s(p.unitPrice), loosePrice: s(p.loosePrice), amount: s(p.amount),
        costAmount: out.cost === null ? null : s(out.cost), costStatus: out.status, costNote: out.note, stockWarning: out.warning,
      }),
    });
    sold.push({ amount: p.amount, cost: out.cost, costStatus: out.status });
  }
  const { entry, total } = postSaleInvoice({ party: refFor(party), lines: sold });
  return finishPosting(tx, ctx, doc, entry, actor, { party, total });
}

async function cashSaleInTx(tx: Tx, actor: Actor, input: CashSaleInput, supersedes?: AccountingDocument) {
  const lines = requireLines(input.lines);
  const cash = await getAccount(tx, input.cashAccountId, ["CASH_BANK"], "Cash/bank account");
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const remarks = [input.customerName ? `Customer: ${input.customerName}` : null, input.remarks].filter(Boolean).join(" | ") || null;
  const doc = await newDocument(tx, {
    type: "CASH_SALE", date, status: "POSTED", cashAccountId: cash.id, locationId: main.id,
    roundingMode: DEFAULT_TOTAL_ROUNDING.CASH_SALE, remarks, createdById: actor.id, postedAt: new Date(),
  }, { supersedes });
  const ctx = await newCtx(tx, doc.id, date);
  const sold: SoldLine[] = [];
  for (const [i, l] of lines.entries()) {
    const item = await loadItem(tx, l.componentId);
    const p = priced(item, l);
    const out = await stockOut(ctx, item, { lineNo: i + 1, locationId: main.id, qty: p.baseQuantity });
    await tx.accountingDocumentLine.create({
      data: lineRecord(doc.id, i + 1, item, l, p.baseQuantity, {
        unitPrice: s(p.unitPrice), loosePrice: s(p.loosePrice), amount: s(p.amount),
        costAmount: out.cost === null ? null : s(out.cost), costStatus: out.status, costNote: out.note, stockWarning: out.warning,
      }),
    });
    sold.push({ amount: p.amount, cost: out.cost, costStatus: out.status });
  }
  const preview = documentTotal(sold.map((l) => l.amount), DEFAULT_TOTAL_ROUNDING.CASH_SALE);
  const received = input.amountReceived === undefined || input.amountReceived === "" ? preview.total : money(input.amountReceived, "Amount received");
  if (cmp(received, preview.total) > 0) throw new PostingError(`Amount received (${s(received)}) is more than the cash sale total (${s(preview.total)})`);
  let party: LedgerAccount | null = null;
  if (input.partyAccountId) party = await getAccount(tx, input.partyAccountId, ["PARTY"], "Customer account");
  else if (cmp(received, preview.total) < 0) party = await accountByCode(tx, await getSetting(tx, "COUNTER_SALE_ACCOUNT")); // F-03
  const { entry, total } = postCashSale({ receivedInto: refFor(cash), amountReceived: received, party: party ? refFor(party) : undefined, lines: sold });
  return finishPosting(tx, ctx, doc, entry, actor, { party, total, extra: { amountReceived: s(received), partyAccountId: party?.id ?? null } });
}

async function purchaseInvoiceInTx(tx: Tx, actor: Actor, input: PurchaseInvoiceInput, supersedes?: AccountingDocument) {
  const lines = requireLines(input.lines);
  const party = await getAccount(tx, input.partyAccountId, ["PARTY"], "Supplier account");
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const doc = await newDocument(tx, {
    type: "PURCHASE_INVOICE", date, status: "POSTED", partyAccountId: party.id, locationId: main.id,
    roundingMode: DEFAULT_TOTAL_ROUNDING.PURCHASE_INVOICE, remarks: input.remarks, createdById: actor.id, postedAt: new Date(),
    vendorBillNo: input.vendorBillNo || null, vendorBillDate: optionalDate(input.vendorBillDate, "Vendor bill date"),
    biltyNo: input.biltyNo || null, biltyDate: optionalDate(input.biltyDate, "Bilty date"),
    dueDate: optionalDate(input.dueDate, "Due date"),
  }, { supersedes });
  if (doc.dueDate && doc.dueDate < date) throw new PostingError("The due date cannot be before the bill date");
  const ctx = await newCtx(tx, doc.id, date);
  const amounts: Dec[] = [];
  for (const [i, l] of lines.entries()) {
    const item = await loadItem(tx, l.componentId);
    const p = priced(item, l);
    await stockIn(ctx, item, { lineNo: i + 1, locationId: main.id, qty: p.baseQuantity, value: p.amount });
    await tx.accountingDocumentLine.create({
      data: lineRecord(doc.id, i + 1, item, l, p.baseQuantity, {
        unitPrice: s(p.unitPrice), loosePrice: s(p.loosePrice), amount: s(p.amount), costAmount: s(p.amount), costStatus: "ACTUAL",
      }),
    });
    amounts.push(p.amount);
  }
  const { entry, total } = postPurchaseInvoice({ party: refFor(party), lineAmounts: amounts });
  // Freight, loading and bilty are recorded for reference only: not in item cost, not owed to the supplier
  await recordChargesInTx(tx, actor, doc, party.id, input.charges, ["FREIGHT", "LOADING", "BILTY", "OTHER_PURCHASE"]);
  return finishPosting(tx, ctx, doc, entry, actor, { party, total });
}

// ─── Stock issues and press work-in-progress (approval required) ──

async function approvalRequired(tx: Tx): Promise<boolean> {
  return (await getSetting(tx, "STOCK_ISSUE_APPROVAL")) !== "NOT_REQUIRED";
}

async function stockIssueInTx(tx: Tx, actor: Actor, input: StockIssueInput, supersedes?: AccountingDocument) {
  const lines = requireLines(input.lines);
  if (!STOCK_ISSUE_REASONS.includes(input.reason)) throw new PostingError(`Reason must be one of ${STOCK_ISSUE_REASONS.join(", ")}`);
  if (!input.remarks?.trim()) throw new PostingError("Explain why the stock is issued");
  const counter = input.counterAccountId ? await getAccount(tx, input.counterAccountId, ["GL", "PARTY"], "Charge account") : null;
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const doc = await newDocument(tx, {
    type: "STOCK_ISSUE", date, status: "PENDING_APPROVAL", locationId: main.id, reason: input.reason, counterAccountId: counter?.id,
    remarks: input.remarks, createdById: actor.id, submittedAt: new Date(),
  }, { supersedes });
  for (const [i, l] of lines.entries()) {
    const item = await loadItem(tx, l.componentId);
    await tx.accountingDocumentLine.create({ data: lineRecord(doc.id, i + 1, item, l, baseQuantityOf(item, l)) });
  }
  await audit(tx, doc.id, "SUBMIT", actor.id, { after: { docNo: doc.docNo, reason: input.reason, lines: lines.length } });
  if (!(await approvalRequired(tx))) return postPendingIssue(tx, actor, doc.id, { autoApproved: true });
  return tx.accountingDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
}

async function pressLossInTx(tx: Tx, actor: Actor, input: PressLossInput, supersedes?: AccountingDocument) {
  const lines = requireLines(input.lines);
  if (!PRESS_LOSS_REASONS.includes(input.reason)) throw new PostingError(`Reason must be one of ${PRESS_LOSS_REASONS.join(", ")}`);
  if (!input.remarks?.trim()) throw new PostingError("Explain the waste, damage or difference");
  const press = await getAccount(tx, input.pressAccountId, ["PARTY"], "Press account");
  const date = toDate(input.date);
  const loc = await pressLocation(tx, press);
  const doc = await newDocument(tx, {
    type: "PRESS_LOSS", date, status: "PENDING_APPROVAL", partyAccountId: press.id, locationId: loc.id, reason: input.reason,
    remarks: input.remarks, createdById: actor.id, submittedAt: new Date(),
  }, { supersedes });
  for (const [i, l] of lines.entries()) {
    const item = await loadItem(tx, l.componentId);
    await tx.accountingDocumentLine.create({ data: lineRecord(doc.id, i + 1, item, l, baseQuantityOf(item, l)) });
  }
  await audit(tx, doc.id, "SUBMIT", actor.id, { after: { docNo: doc.docNo, reason: input.reason, lines: lines.length } });
  if (!(await approvalRequired(tx))) return postPendingIssue(tx, actor, doc.id, { autoApproved: true });
  return tx.accountingDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
}

/** Post an approved count: book quantity is taken now, the difference goes in at average cost or out at cost. */
async function postCount(tx: Tx, actor: Actor, doc: Prisma.AccountingDocumentGetPayload<{ include: { lines: true } }>) {
  const ctx = await newCtx(tx, doc.id, doc.date);
  let gain = ZERO;
  let loss = ZERO;
  const applied: { componentId: string; name: string; screenBefore: number; booksBefore: string; counted: string; adjustment: string }[] = [];
  for (const line of doc.lines) {
    const item = await loadItem(tx, line.componentId!);
    const book = await locationBalance(tx, item.componentId, doc.locationId!);
    // The count is the truth for both records: Books moves by (counted - Books quantity), and the item's count on the
    // Inventory and Sales screens is set to what was counted, even if stock was entered outside Books before
    const screenBefore = (await tx.component.findUniqueOrThrow({ where: { id: item.componentId }, select: { quantity: true } })).quantity;
    await withoutItemCountChange(() => countLine(ctx, item, line, book).then((r) => { gain = add(gain, r.gain); loss = add(loss, r.loss); }));
    const counted = Math.round(Number(line.baseQuantity));
    if (counted !== screenBefore) {
      await tx.component.update({ where: { id: item.componentId }, data: { quantity: counted } });
    }
    await tx.inventoryHistory.create({
      data: {
        componentId: item.componentId, type: "ADJUST", quantity: Math.abs(counted - screenBefore), balanceAfter: counted,
        reference: `Books ${doc.docNo} stock count (was ${screenBefore}, counted ${counted})`, performedBy: actor.id,
      },
    });
    applied.push({ componentId: item.componentId, name: item.name, screenBefore, booksBefore: s(book), counted: line.baseQuantity, adjustment: String(counted - screenBefore) });
  }
  await audit(tx, doc.id, "COUNT_APPLIED", actor.id, { after: applied });
  return finishPosting(tx, ctx, doc, postStockAdjustment({ gain, loss }), actor);
}

/** One counted line: stock moves by the difference from Books, valued at average cost. */
async function countLine(ctx: PostCtx, item: ItemContext, line: { id: string; lineNo: number; baseQuantity: string }, book: Dec) {
  const { tx } = ctx;
  const locationId = (await tx.accountingDocument.findUniqueOrThrow({ where: { id: ctx.documentId }, select: { locationId: true } })).locationId!;
  let gain = ZERO;
  let loss = ZERO;
  const diff = sub(dec(line.baseQuantity), book);
  let costAmount: Dec | null = null;
  let costStatus: CostStatus = "ACTUAL";
  let note: string | undefined;
  if (cmp(diff, ZERO) > 0) {
    const st = await costState(tx, item.componentId);
    costAmount = st.averageCost === null ? null : mul(diff, st.averageCost);
    if (costAmount === null) { costStatus = "UNAVAILABLE"; note = "No cost recorded for this item; the gain is not valued"; }
    await stockIn(ctx, item, { lineNo: line.lineNo, locationId, qty: diff, value: costAmount });
    if (costAmount !== null) gain = costAmount;
  } else if (cmp(diff, ZERO) < 0) {
    const out = await stockOut(ctx, item, { lineNo: line.lineNo, locationId, qty: sub(ZERO, diff) });
    costAmount = out.cost;
    costStatus = out.status;
    note = out.note;
    if (out.cost !== null) loss = out.cost;
  }
  await tx.accountingDocumentLine.update({
    where: { id: line.id },
    data: { bookQuantity: s(book), costAmount: costAmount === null ? null : s(costAmount), costStatus, costNote: note },
  });
  return { gain, loss };
}

/** Post an approved stock issue or press loss: stock leaves its location and its cost moves to the charge account. */
async function postPendingIssue(tx: Tx, actor: Actor, id: string, opts: { autoApproved?: boolean; overrideReason?: string } = {}) {
  const now = new Date();
  let selfOverride = false;
  if (!opts.autoApproved) {
    // Separation of duties: the person who prepared an issue does not approve it. The only exception is
    // the owner account named in SELF_APPROVAL_OVERRIDE_USER, with a written reason (audited separately).
    const pending = await tx.accountingDocument.findUnique({ where: { id }, select: { createdById: true } });
    if (pending && pending.createdById === actor.id) {
      const overrideUser = await getSetting(tx, "SELF_APPROVAL_OVERRIDE_USER");
      if (!overrideUser || overrideUser !== actor.id) {
        throw new PostingError("You prepared this document, so another administrator must approve it (separation of duties)", 403);
      }
      if ((opts.overrideReason ?? "").trim().length < 10) {
        throw new PostingError("Approving your own document needs a written override reason (at least 10 characters)");
      }
      selfOverride = true;
    }
  }
  const claimed = await tx.accountingDocument.updateMany({
    where: { id, status: "PENDING_APPROVAL", type: { in: ["STOCK_ISSUE", "PRESS_LOSS", "STOCK_ADJUSTMENT"] } },
    data: { status: "POSTED", postedAt: now, ...(opts.autoApproved ? {} : { approvedById: actor.id, approvedAt: now }) },
  });
  if (claimed.count !== 1) throw new PostingError("Only a document waiting for approval can be approved", 409);
  const doc = await tx.accountingDocument.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (doc.type === "STOCK_ADJUSTMENT") {
    if (!opts.autoApproved) await audit(tx, id, selfOverride ? "APPROVE_SELF_OVERRIDE" : "APPROVE", actor.id, selfOverride ? { reason: opts.overrideReason!.trim() } : {});
    return postCount(tx, actor, doc);
  }
  let chargeAccount: LedgerAccount;
  if (doc.counterAccountId) chargeAccount = await getAccount(tx, doc.counterAccountId, ["GL", "PARTY"], "Charge account");
  else {
    const key = (doc.type === "PRESS_LOSS" ? "PRESS_LOSS_ACCOUNT" : `ISSUE_ACCOUNT_${doc.reason}`) as SettingKey;
    chargeAccount = await accountByCode(tx, String(await getSetting(tx, key)));
  }
  const ctx = await newCtx(tx, doc.id, doc.date);
  const issued: SoldLine[] = [];
  for (const line of doc.lines) {
    const item = await loadItem(tx, line.componentId!);
    const out = await stockOut(ctx, item, { lineNo: line.lineNo, locationId: doc.locationId!, qty: dec(line.baseQuantity) });
    await tx.accountingDocumentLine.update({
      where: { id: line.id },
      data: { costAmount: out.cost === null ? null : s(out.cost), costStatus: out.status, costNote: out.note, stockWarning: out.warning },
    });
    issued.push({ amount: ZERO, cost: out.cost, costStatus: out.status });
  }
  const entry = postStockIssue({ issueAccount: refFor(chargeAccount), lines: issued });
  if (!opts.autoApproved) await audit(tx, id, selfOverride ? "APPROVE_SELF_OVERRIDE" : "APPROVE", actor.id, selfOverride ? { reason: opts.overrideReason!.trim() } : {});
  return finishPosting(tx, ctx, doc, entry, actor, { extra: { counterAccountId: chargeAccount.id } });
}

async function pressMovementInTx(tx: Tx, actor: Actor, type: "PRESS_DISPATCH" | "PRESS_RETURN", input: PressMovementInput, supersedes?: AccountingDocument) {
  const lines = requireLines(input.lines);
  const press = await getAccount(tx, input.pressAccountId, ["PARTY"], "Press account");
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const atPress = await pressLocation(tx, press);
  const [from, to] = type === "PRESS_DISPATCH" ? [main, atPress] : [atPress, main];
  const doc = await newDocument(tx, {
    type, date, status: "POSTED", partyAccountId: press.id, locationId: from.id, toLocationId: to.id,
    remarks: input.remarks, createdById: actor.id, postedAt: new Date(),
  }, { supersedes });
  const ctx = await newCtx(tx, doc.id, date);
  for (const [i, l] of lines.entries()) {
    const item = await loadItem(tx, l.componentId);
    const qty = baseQuantityOf(item, l);
    const moved = await relocate(ctx, item, { lineNo: i + 1, fromId: from.id, toId: to.id, qty });
    await tx.accountingDocumentLine.create({ data: lineRecord(doc.id, i + 1, item, l, qty, { stockWarning: moved.warning }) });
  }
  // No journal: material at the press is still the business's stock (owner decision 2c)
  return finishPosting(tx, ctx, doc, { documentType: type, lines: [] }, actor);
}

async function pressReceiptInTx(tx: Tx, actor: Actor, input: PressReceiptInput, supersedes?: AccountingDocument) {
  const lines = requireLines(input.lines);
  const press = await getAccount(tx, input.pressAccountId, ["PARTY"], "Press account");
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const atPress = await pressLocation(tx, press);
  const doc = await newDocument(tx, {
    type: "PRESS_RECEIPT", date, status: "POSTED", partyAccountId: press.id, locationId: atPress.id, toLocationId: main.id,
    remarks: input.remarks, createdById: actor.id, postedAt: new Date(),
  }, { supersedes });
  const ctx = await newCtx(tx, doc.id, date);
  for (const [i, l] of lines.entries()) {
    const material = await loadItem(tx, l.consumedComponentId);
    const used = baseQuantityOf(material, { quantity: l.consumedQuantity, unit: l.consumedUnit, loose: l.consumedLoose });
    const out = await stockOut(ctx, material, { lineNo: i + 1, locationId: atPress.id, qty: used });
    const product = await loadItem(tx, l.componentId);
    const made = baseQuantityOf(product, l);
    // Printed goods carry the cost of the material used and nothing else; printing charges are never
    // capitalised automatically (2026-10-22 rule). Unknown material cost stays unknown.
    const value = out.cost;
    await stockIn(ctx, product, { lineNo: i + 1, locationId: main.id, qty: made, value });
    await tx.accountingDocumentLine.create({
      data: lineRecord(doc.id, i + 1, product, l, made, {
        costAmount: value === null ? null : s(value), costStatus: value === null ? "UNAVAILABLE" : out.status,
        costNote: out.note, stockWarning: out.warning, consumedComponentId: material.componentId, consumedQuantity: s(used),
      }),
    });
  }
  await recordChargesInTx(tx, actor, doc, press.id, input.charges, ["PRINTING"]);
  // No journal: material cost moves within stock, and recorded charges post nothing
  return finishPosting(tx, ctx, doc, { documentType: "PRESS_RECEIPT", lines: [] }, actor);
}

/**
 * Record charges against a document (2026-10-22 rule): status RECORDED, no journal, no stock value, no
 * balance change. Posting as an expense is a separate, explicit action (charges.ts).
 */
export async function recordChargesInTx(tx: Tx, actor: Actor, doc: { id: string; date: Date } | null, defaultPartyId: string | null, charges: ChargeInput[] | undefined, allowed: readonly ChargeKind[]) {
  const created = [];
  for (const c of charges ?? []) {
    if (!allowed.includes(c.kind)) throw new PostingError(`A ${c.kind.toLowerCase().replace("_", " ")} charge cannot be recorded on this document`);
    const amount = money(c.amount, "Charge amount");
    if (isZero(amount)) throw new PostingError("Charge amount must be more than zero");
    if (!c.description?.trim()) throw new PostingError("Describe the charge");
    const partyAccountId = c.partyAccountId ?? defaultPartyId;
    if (partyAccountId) await getAccount(tx, partyAccountId, ["PARTY"], "Charge party");
    const number = await nextNumber(tx, "CHG");
    const charge = await tx.chargeRecord.create({
      data: {
        number, chargeNo: `CHG-${String(number).padStart(4, "0")}`, kind: c.kind, date: c.date ? toDate(c.date) : doc?.date ?? new Date(),
        amount: s(amount), description: c.description.trim(), partyAccountId, documentId: doc?.id ?? null, reference: c.reference || null,
        status: "RECORDED", createdById: actor.id,
      },
    });
    await tx.auditLog.create({ data: { entity: "ChargeRecord", entityId: charge.id, action: "CREATE", userId: actor.id, after: jsonSafe(charge) } });
    created.push(charge);
  }
  return created;
}

// ─── Returns (D-08) and stock counts (D-09) ────────────────────────

async function originalFor(tx: Tx, id: string, types: string[]) {
  const original = await tx.accountingDocument.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!original) throw new PostingError("Original document not found", 404);
  if (!types.includes(original.type)) throw new PostingError(`Only a ${types.join(" or ").toLowerCase().replace(/_/g, " ")} can be returned here`);
  if (original.status !== "POSTED") throw new PostingError("Only a posted document can be returned", 409);
  return original;
}

/** Validate each returned line against what is still returnable and price it at the original price. */
async function returnLines(tx: Tx, original: Awaited<ReturnType<typeof originalFor>>, lines: ReturnLineInput[]) {
  const earlier = await tx.accountingDocumentLine.findMany({ where: { document: { returnOfId: original.id, status: "POSTED" } } });
  const result = [];
  for (const l of requireLines(lines)) {
    const orig = original.lines.find((x) => x.lineNo === l.lineNo);
    if (!orig || !orig.componentId) throw new PostingError(`Line ${l.lineNo} is not on ${original.docNo}`);
    const item = await loadItem(tx, orig.componentId);
    const base = baseQuantityOf(item, l);
    const returned = earlier.filter((x) => x.returnOfLineNo === l.lineNo).reduce((a, x) => add(a, dec(x.baseQuantity)), ZERO);
    const left = sub(dec(orig.baseQuantity), returned);
    if (cmp(base, left) > 0) throw new PostingError(`${item.name}: only ${s(left)} ${item.cfg.baseUnit} of line ${l.lineNo} can still be returned`);
    // Same unit as the original line: original unit price; otherwise the original price per base unit
    const amount = (l.unit ?? item.cfg.baseUnit) === orig.unit
      ? priceLine({ unit: item.cfg, quantity: { quantity: l.quantity, unit: l.unit, loose: l.loose }, unitPrice: orig.unitPrice }).amount
      : mul(dec(orig.loosePrice), base);
    const unitCost = orig.costAmount === null ? null : div(dec(orig.costAmount), dec(orig.baseQuantity));
    result.push({ l, orig, item, base, amount, unitCost });
  }
  return result;
}

async function saleReturnInTx(tx: Tx, actor: Actor, input: SaleReturnInput, supersedes?: AccountingDocument) {
  const original = await originalFor(tx, input.originalDocumentId, ["SALE_INVOICE", "CASH_SALE"]);
  const refund = input.refundAccountId ? await getAccount(tx, input.refundAccountId, ["CASH_BANK"], "Refund account") : null;
  const party = original.partyAccountId ? await getAccount(tx, original.partyAccountId, ["PARTY"], "Customer account") : null;
  const creditTo = refund ?? party;
  if (!creditTo) throw new PostingError("This sale has no customer account; choose the cash or bank account the refund is paid from");
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const doc = await newDocument(tx, {
    type: "SALE_RETURN", date, status: "POSTED", returnOfId: original.id, partyAccountId: refund ? null : party!.id, cashAccountId: refund?.id ?? null,
    locationId: main.id, roundingMode: original.roundingMode, remarks: input.remarks ?? `Return against ${original.docNo}`, createdById: actor.id, postedAt: new Date(),
  }, { supersedes });
  const ctx = await newCtx(tx, doc.id, date);
  const returned: ReturnedLine[] = [];
  for (const [i, r] of (await returnLines(tx, original, input.lines)).entries()) {
    const cost = r.unitCost === null ? null : mul(r.base, r.unitCost);
    await stockIn(ctx, r.item, { lineNo: i + 1, locationId: main.id, qty: r.base, value: cost });
    await tx.accountingDocumentLine.create({
      data: lineRecord(doc.id, i + 1, r.item, { componentId: r.item.componentId, quantity: r.l.quantity, unit: r.l.unit, loose: r.l.loose }, r.base, {
        unitPrice: r.orig.unitPrice, loosePrice: r.orig.loosePrice, amount: s(r.amount), costAmount: cost === null ? null : s(cost),
        costStatus: cost === null ? "UNAVAILABLE" : r.orig.costStatus, returnOfLineNo: r.l.lineNo,
      }),
    });
    returned.push({ amount: r.amount, cost });
  }
  const { entry, total } = postSaleReturn({ creditTo: refFor(creditTo), lines: returned, rounding: (original.roundingMode as "RUPEE_HALF_EVEN" | "PAISA_HALF_EVEN" | null) ?? undefined });
  return finishPosting(tx, ctx, doc, entry, actor, { party: refund ? null : party, total });
}

async function purchaseReturnInTx(tx: Tx, actor: Actor, input: PurchaseReturnInput, supersedes?: AccountingDocument) {
  const original = await originalFor(tx, input.originalDocumentId, ["PURCHASE_INVOICE"]);
  const party = await getAccount(tx, original.partyAccountId, ["PARTY"], "Supplier account");
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const doc = await newDocument(tx, {
    type: "PURCHASE_RETURN", date, status: "POSTED", returnOfId: original.id, partyAccountId: party.id, locationId: main.id,
    roundingMode: original.roundingMode, remarks: input.remarks ?? `Return against ${original.docNo}`, createdById: actor.id, postedAt: new Date(),
  }, { supersedes });
  const ctx = await newCtx(tx, doc.id, date);
  const amounts: Dec[] = [];
  for (const [i, r] of (await returnLines(tx, original, input.lines)).entries()) {
    // Purchase lines are their own cost, so the stock leaves at the value it came in with
    const moved = await stockOutAtValue(ctx, r.item, { lineNo: i + 1, locationId: main.id, qty: r.base, value: r.amount });
    await tx.accountingDocumentLine.create({
      data: lineRecord(doc.id, i + 1, r.item, { componentId: r.item.componentId, quantity: r.l.quantity, unit: r.l.unit, loose: r.l.loose }, r.base, {
        unitPrice: r.orig.unitPrice, loosePrice: r.orig.loosePrice, amount: s(r.amount), costAmount: s(r.amount), costStatus: "ACTUAL",
        stockWarning: moved.warning, returnOfLineNo: r.l.lineNo,
      }),
    });
    amounts.push(r.amount);
  }
  const { entry, total } = postPurchaseReturn({ party: refFor(party), lineAmounts: amounts });
  return finishPosting(tx, ctx, doc, entry, actor, { party, total });
}

async function stockAdjustmentInTx(tx: Tx, actor: Actor, input: StockAdjustmentInput, supersedes?: AccountingDocument) {
  const lines = requireLines(input.lines);
  if (!input.remarks?.trim()) throw new PostingError("Explain the count (who counted, when)");
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const doc = await newDocument(tx, {
    type: "STOCK_ADJUSTMENT", date, status: "PENDING_APPROVAL", locationId: main.id, remarks: input.remarks, createdById: actor.id, submittedAt: new Date(),
  }, { supersedes });
  const seen = new Set<string>();
  for (const [i, l] of lines.entries()) {
    if (seen.has(l.componentId)) throw new PostingError("Count each item on one line only");
    seen.add(l.componentId);
    const item = await loadItem(tx, l.componentId);
    // A counted quantity may be zero (nothing found)
    let counted: Dec;
    try {
      counted = toBaseQuantity(item.cfg, { quantity: l.quantity, unit: l.unit, loose: l.loose });
    } catch (e) {
      throw new PostingError(`${item.name}: ${(e as Error).message}`);
    }
    await tx.accountingDocumentLine.create({ data: lineRecord(doc.id, i + 1, item, l, counted) });
  }
  await audit(tx, doc.id, "SUBMIT", actor.id, { after: { docNo: doc.docNo, lines: lines.length } });
  if (!(await approvalRequired(tx))) return postPendingIssue(tx, actor, doc.id, { autoApproved: true });
  return tx.accountingDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
}

// ─── Opening stock ─────────────────────────────────────────────────

async function openingStockInTx(tx: Tx, actor: Actor, input: OpeningStockInput, supersedes?: AccountingDocument) {
  const lines = requireLines(input.lines);
  const date = toDate(input.date);
  const main = await locationByCode(tx, MAIN_LOCATION);
  const doc = await newDocument(tx, {
    type: "OPENING_STOCK", date, status: "POSTED", locationId: main.id, remarks: input.remarks ?? "Opening stock", createdById: actor.id, postedAt: new Date(),
  }, { supersedes });
  const ctx = await newCtx(tx, doc.id, date);
  const values: Dec[] = [];
  const seen = new Set<string>();
  for (const [i, l] of lines.entries()) {
    if (seen.has(l.componentId)) throw new PostingError("List each item once");
    seen.add(l.componentId);
    const item = await loadItem(tx, l.componentId);
    const entry = { componentId: l.componentId, quantity: l.quantity, unit: l.unit, loose: l.loose };
    const qty = baseQuantityOf(item, entry);
    // Opening stock is valued at what it cost; an unknown cost stays unresolved and is never entered as zero
    const cost = money(l.unitCost, `${item.name}: cost`);
    if (cmp(cost, ZERO) <= 0) throw new PostingError(`${item.name}: enter what one ${l.unit ?? item.cfg.baseUnit} cost; opening stock is never valued at zero`);
    const value = roundHalfEven(mul(qty, pricePerBaseUnit(item.cfg, cost, l.unit)), 2);
    await stockIn(ctx, item, { lineNo: i + 1, locationId: main.id, qty, value, kind: "RECEIPT" });
    await tx.accountingDocumentLine.create({
      data: lineRecord(doc.id, i + 1, item, entry, qty, { unitPrice: s(cost), amount: s(value), costAmount: s(value), costStatus: "ACTUAL" }),
    });
    values.push(value);
  }
  const entry = postOpeningStock({ values });
  const total = values.reduce((t, v) => add(t, v), ZERO);
  return finishPosting(tx, ctx, doc, entry, actor, { total: { exact: total, total, roundingAdjustment: ZERO } });
}

// ─── Vouchers, transfers, opening balances ─────────────────────────

async function voucherInTx(tx: Tx, actor: Actor, input: VoucherInput, supersedes?: AccountingDocument) {
  if (!VOUCHER_SERIES.includes(input.series)) throw new PostingError(`Voucher type must be one of ${VOUCHER_SERIES.join(", ")}`);
  if (supersedes && supersedes.series !== input.series) throw new PostingError("An amendment keeps the voucher type; cancel and enter a new voucher instead");
  const amount = money(input.amount, "Amount");
  // OD-12 (legacy behaviour kept): a zero-amount voucher is allowed as a record, but only with a remark
  if (isZero(amount) && !input.remarks?.trim()) throw new PostingError("A zero-amount voucher needs a remark explaining it");
  if (input.debitAccountId === input.creditAccountId) throw new PostingError("Debit and credit accounts must be different");
  const debit = await getAccount(tx, input.debitAccountId, [], "Debit account");
  const credit = await getAccount(tx, input.creditAccountId, [], "Credit account");
  const isCash = (a: LedgerAccount, sub?: string) => a.kind === "CASH_BANK" && (!sub || a.subType === sub);
  const rules: Record<VoucherSeries, [boolean, string]> = {
    CRV: [isCash(debit, "CASH") && !isCash(credit), "A cash receipt voucher debits a cash account and credits a party or other account"],
    BRV: [isCash(debit, "BANK") && !isCash(credit), "A bank receipt voucher debits a bank account and credits a party or other account"],
    CPV: [isCash(credit, "CASH") && !isCash(debit), "A cash payment voucher credits a cash account and debits a party or other account"],
    BPV: [isCash(credit, "BANK") && !isCash(debit), "A bank payment voucher credits a bank account and debits a party or other account"],
    JV: [!isCash(debit) && !isCash(credit), "A journal voucher cannot use cash or bank accounts; use a receipt, payment or transfer"],
  };
  const [ok, message] = rules[input.series];
  if (!ok) throw new PostingError(message);
  const date = toDate(input.date);
  const party = [debit, credit].find((a) => a.kind === "PARTY") ?? null;
  const cash = [debit, credit].find((a) => a.kind === "CASH_BANK") ?? null;
  const counter = input.series === "JV" ? credit : [debit, credit].find((a) => a.kind !== "CASH_BANK")!;
  const doc = await newDocument(tx, {
    type: "VOUCHER", date, status: "POSTED", partyAccountId: party?.id, cashAccountId: cash?.id, counterAccountId: counter.id,
    remarks: input.remarks, createdById: actor.id, postedAt: new Date(),
  }, { series: input.series, supersedes });
  const documentType = input.series === "JV" ? "JOURNAL_VOUCHER" : input.series.endsWith("RV") ? "RECEIPT_VOUCHER" : "PAYMENT_VOUCHER";
  const entry = postVoucher({ documentType, debit: refFor(debit), credit: refFor(credit), amount });
  const ctx = await newCtx(tx, doc.id, date);
  return finishPosting(tx, ctx, doc, entry, actor, { party, total: { exact: amount, total: amount, roundingAdjustment: ZERO } });
}

async function transferInTx(tx: Tx, actor: Actor, input: TransferInput, supersedes?: AccountingDocument) {
  const amount = money(input.amount, "Amount");
  if (isZero(amount)) throw new PostingError("Amount must be more than zero");
  if (input.fromAccountId === input.toAccountId) throw new PostingError("Choose two different accounts");
  const from = await getAccount(tx, input.fromAccountId, ["CASH_BANK"], "From account");
  const to = await getAccount(tx, input.toAccountId, ["CASH_BANK"], "To account");
  const date = toDate(input.date);
  const doc = await newDocument(tx, {
    type: "TRANSFER", date, status: "POSTED", cashAccountId: from.id, counterAccountId: to.id,
    remarks: input.remarks, createdById: actor.id, postedAt: new Date(),
  }, { supersedes });
  const entry = postTransfer({ from: refFor(from), to: refFor(to), amount });
  const ctx = await newCtx(tx, doc.id, date);
  return finishPosting(tx, ctx, doc, entry, actor, { total: { exact: amount, total: amount, roundingAdjustment: ZERO } });
}

async function openingBalanceInTx(tx: Tx, actor: Actor, input: OpeningBalanceInput, supersedes?: AccountingDocument) {
  const debit = input.debit === undefined || input.debit === "" ? ZERO : money(input.debit, "Debit");
  const credit = input.credit === undefined || input.credit === "" ? ZERO : money(input.credit, "Credit");
  if (isZero(debit) === isZero(credit)) throw new PostingError("Enter either a debit or a credit opening balance");
  const account = await getAccount(tx, input.accountId, ["PARTY", "CASH_BANK", "GL"], "Account");
  if (account.code === "OPENING_BALANCE_EQUITY") throw new PostingError("Choose the account whose opening balance is being entered");
  const date = toDate(input.date);
  const doc = await newDocument(tx, {
    type: "OPENING_BALANCE", date, status: "POSTED", partyAccountId: account.kind === "PARTY" ? account.id : null,
    counterAccountId: account.id, remarks: input.remarks, createdById: actor.id, postedAt: new Date(),
  }, { supersedes });
  const entry = postOpeningBalance({ account: refFor(account), debit, credit });
  const amount = isZero(debit) ? credit : debit;
  const ctx = await newCtx(tx, doc.id, date);
  return finishPosting(tx, ctx, doc, entry, actor, { party: account.kind === "PARTY" ? account : null, total: { exact: amount, total: amount, roundingAdjustment: ZERO } });
}

// ─── Cancellation and amendment (OD-11) ────────────────────────────

/** Cancel a posted document by reversing its journal and stock movements; nothing is deleted. */
export async function cancelInTx(tx: Tx, actor: Actor, id: string, reason: string, action = "CANCEL", opts: { fromCharge?: boolean } = {}) {
  if (!reason?.trim()) throw new PostingError("A reason is required");
  const doc = await tx.accountingDocument.findUnique({
    where: { id },
    include: { journalEntries: { include: { lines: true } }, stockMovements: { orderBy: { createdAt: "asc" } } },
  });
  if (!doc) throw new PostingError("Document not found", 404);
  // An expense posting belongs to its charge record; reversing it elsewhere would leave the charge "posted"
  if (doc.type === "CHARGE_EXPENSE" && !opts.fromCharge) throw new PostingError("Reverse this posting from its charge record", 409);
  // Money from this receipt was paid back to the customer: the refund has to be cancelled first (Report 28)
  const refunds = await refundsFundedBy(tx, id);
  if (refunds.length) throw new PostingError(`Part of this payment was refunded (${refunds.join(", ")}); cancel the refund first`, 409);
  // Goods returned against this bill: the return refers to its lines, so it has to be cancelled first (Report 30)
  const returns = await tx.accountingDocument.findMany({ where: { returnOfId: id, status: "POSTED" }, select: { docNo: true } });
  if (returns.length) throw new PostingError(`Goods were returned against this bill (${returns.map((r) => r.docNo).join(", ")}); cancel the return first`, 409);
  const now = new Date();
  if (doc.status === "PENDING_APPROVAL") {
    await tx.accountingDocument.update({ where: { id }, data: { status: "CANCELLED", cancelledById: actor.id, cancelledAt: now, cancelReason: reason } });
    await audit(tx, id, action, actor.id, { reason, before: { status: doc.status } });
    return doc;
  }
  const claimed = await tx.accountingDocument.updateMany({
    where: { id, status: "POSTED" },
    data: { status: "CANCELLED", cancelledById: actor.id, cancelledAt: now, cancelReason: reason },
  });
  if (claimed.count !== 1) throw new PostingError(`A ${doc.status.toLowerCase().replace("_", " ")} document cannot be cancelled`, 409);

  const ctx = await newCtx(tx, doc.id, doc.date);
  for (const m of [...doc.stockMovements].reverse()) {
    const item = await loadItem(tx, m.componentId);
    const qty = dec(m.quantity);
    const value = m.costAmount === null ? null : dec(m.costAmount);
    const absQty = isNegative(qty) ? sub(ZERO, qty) : qty;
    let balanceAfter: Dec;
    let warning: string | undefined;
    if (cmp(qty, ZERO) > 0) {
      // Undo stock that came in at this location
      const taken = await takeFromLocation(ctx, item, m.locationId, absQty);
      balanceAfter = taken.balanceAfter;
      warning = taken.warning;
      if (m.kind === "RECEIPT") await saveCostState(tx, m.componentId, reverseReceipt(await costState(tx, m.componentId), absQty, value));
    } else {
      // Put back stock that went out of this location, at the cost it left with
      balanceAfter = add(await locationBalance(tx, m.componentId, m.locationId), absQty);
      await saveLocationBalance(tx, m.componentId, m.locationId, balanceAfter, { docNo: doc.docNo, userId: actor.id, note: "reversed" });
      if (m.kind === "ISSUE") {
        const st = await costState(tx, m.componentId);
        await saveCostState(tx, m.componentId, value === null ? receiveUncosted(st, absQty) : receive(st, absQty, div(sub(ZERO, value), absQty)));
      }
    }
    await tx.stockMovement.create({
      data: {
        documentId: doc.id, lineNo: m.lineNo, componentId: m.componentId, locationId: m.locationId, date: doc.date,
        kind: `${m.kind}_REVERSAL`, quantity: s(sub(ZERO, qty)), balanceAfter: s(balanceAfter),
        costAmount: value === null ? null : s(sub(ZERO, value)), costStatus: m.costStatus, warning,
      },
    });
  }
  for (const je of doc.journalEntries.filter((e) => e.kind === "POSTING")) {
    await tx.journalEntry.create({
      data: {
        documentId: doc.id, date: doc.date, kind: "REVERSAL", createdById: actor.id,
        lines: { create: je.lines.map((l) => ({ accountId: l.accountId, debitPaisa: l.creditPaisa, creditPaisa: l.debitPaisa, memo: `Reversal: ${l.memo ?? ""}`.trim() })) },
      },
    });
  }
  // Its payments become unapplied credit again; an amendment instead carries them to the new revision (Report 28)
  const released = action === "AMEND" ? [] : await releaseForCancelled(tx, id, actor.id, reason);
  await audit(tx, id, action, actor.id, {
    reason,
    before: { status: "POSTED", total: doc.total, ...(released.length ? { releasedAllocations: released.map((a) => ({ id: a.id, amount: a.amount })) } : {}) },
  });
  return tx.accountingDocument.findUniqueOrThrow({ where: { id } });
}

// ─── Public API ────────────────────────────────────────────────────

type Creator<I> = (tx: Tx, actor: Actor, input: I, supersedes?: AccountingDocument) => Promise<unknown>;

const CREATORS: Record<string, Creator<never>> = {
  SALE_INVOICE: saleInvoiceInTx as Creator<never>,
  CASH_SALE: cashSaleInTx as Creator<never>,
  PURCHASE_INVOICE: purchaseInvoiceInTx as Creator<never>,
  STOCK_ISSUE: stockIssueInTx as Creator<never>,
  PRESS_LOSS: pressLossInTx as Creator<never>,
  PRESS_RECEIPT: pressReceiptInTx as Creator<never>,
  SALE_RETURN: saleReturnInTx as Creator<never>,
  PURCHASE_RETURN: purchaseReturnInTx as Creator<never>,
  STOCK_ADJUSTMENT: stockAdjustmentInTx as Creator<never>,
  VOUCHER: voucherInTx as Creator<never>,
  TRANSFER: transferInTx as Creator<never>,
  OPENING_BALANCE: openingBalanceInTx as Creator<never>,
  OPENING_STOCK: openingStockInTx as Creator<never>,
};

const TX_OPTIONS = { timeout: 60_000 };

/**
 * Run a workflow in one transaction. When the caller already holds a transaction (the sync executor, which
 * must record the command in the same transaction, or a preview that will be rolled back), join it.
 */
export function run<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if ("$transaction" in db && typeof db.$transaction === "function") return (db as PrismaClient).$transaction(fn, TX_OPTIONS);
  return fn(db as Tx);
}

export const createSaleInvoice = (db: Db, actor: Actor, input: SaleInvoiceInput) => run(db, (tx) => saleInvoiceInTx(tx, actor, input));
export const createCashSale = (db: Db, actor: Actor, input: CashSaleInput) => run(db, (tx) => cashSaleInTx(tx, actor, input));
export const createPurchaseInvoice = (db: Db, actor: Actor, input: PurchaseInvoiceInput) => run(db, (tx) => purchaseInvoiceInTx(tx, actor, input));
export const createStockIssue = (db: Db, actor: Actor, input: StockIssueInput) => run(db, (tx) => stockIssueInTx(tx, actor, input));
export const createPressDispatch = (db: Db, actor: Actor, input: PressMovementInput) => run(db, (tx) => pressMovementInTx(tx, actor, "PRESS_DISPATCH", input));
export const createPressReturn = (db: Db, actor: Actor, input: PressMovementInput) => run(db, (tx) => pressMovementInTx(tx, actor, "PRESS_RETURN", input));
export const createPressReceipt = (db: Db, actor: Actor, input: PressReceiptInput) => run(db, (tx) => pressReceiptInTx(tx, actor, input));
export const createPressLoss = (db: Db, actor: Actor, input: PressLossInput) => run(db, (tx) => pressLossInTx(tx, actor, input));
export const createSaleReturn = (db: Db, actor: Actor, input: SaleReturnInput) => run(db, (tx) => saleReturnInTx(tx, actor, input));
export const createPurchaseReturn = (db: Db, actor: Actor, input: PurchaseReturnInput) => run(db, (tx) => purchaseReturnInTx(tx, actor, input));
export const createStockAdjustment = (db: Db, actor: Actor, input: StockAdjustmentInput) => run(db, (tx) => stockAdjustmentInTx(tx, actor, input));
export const createVoucher = (db: Db, actor: Actor, input: VoucherInput) => run(db, (tx) => voucherInTx(tx, actor, input));
export const createTransfer = (db: Db, actor: Actor, input: TransferInput) => run(db, (tx) => transferInTx(tx, actor, input));
export const createOpeningBalance = (db: Db, actor: Actor, input: OpeningBalanceInput) => run(db, (tx) => openingBalanceInTx(tx, actor, input));
export const createOpeningStock = (db: Db, actor: Actor, input: OpeningStockInput) => run(db, (tx) => openingStockInTx(tx, actor, input));

function requireApprover(actor: Actor) {
  if (!can(actor.role, "stockApproval", "write")) throw new PostingError("Only an administrator can approve or reject stock issues", 403);
}

/** Owner instruction 4: an administrator approves a pending stock issue or press loss, which posts it. */
export async function approveDocument(db: Db, actor: Actor, id: string, opts: { overrideReason?: string } = {}) {
  requireApprover(actor);
  return run(db, (tx) => postPendingIssue(tx, actor, id, { overrideReason: opts.overrideReason }));
}

export async function rejectDocument(db: Db, actor: Actor, id: string, reason: string) {
  requireApprover(actor);
  if (!reason?.trim()) throw new PostingError("A reason is required");
  return run(db, async (tx) => {
    const now = new Date();
    const claimed = await tx.accountingDocument.updateMany({
      where: { id, status: "PENDING_APPROVAL" },
      data: { status: "REJECTED", rejectedById: actor.id, rejectedAt: now, rejectionReason: reason },
    });
    if (claimed.count !== 1) throw new PostingError("Only a document waiting for approval can be rejected", 409);
    await audit(tx, id, "REJECT", actor.id, { reason });
    return tx.accountingDocument.findUniqueOrThrow({ where: { id } });
  });
}

export async function cancelDocument(db: Db, actor: Actor, id: string, reason: string) {
  return run(db, (tx) => cancelInTx(tx, actor, id, reason));
}

/**
 * Amend a document (OD-11): the old version is cancelled with full reversal and a new revision with the
 * same number is posted from `input`. Both versions and the audit trail are kept.
 */
export async function amendDocument(db: Db, actor: Actor, id: string, input: unknown, reason: string) {
  return run(db, async (tx) => {
    const old = await tx.accountingDocument.findUnique({ where: { id } });
    if (!old) throw new PostingError("Document not found", 404);
    const creator = CREATORS[old.type];
    if (!creator) throw new PostingError("This type of document cannot be amended; cancel it and enter a new one");
    if (old.status !== "POSTED" && old.status !== "PENDING_APPROVAL") throw new PostingError("Only a posted or pending document can be amended", 409);
    await cancelInTx(tx, actor, id, `Amended: ${reason}`, "AMEND");
    const fresh = await tx.accountingDocument.findUniqueOrThrow({ where: { id } });
    const revised = (await creator(tx, actor, input as never, fresh)) as AccountingDocument;
    // Payments follow the bill (and a receipt's allocations follow the receipt) to the new revision (Report 28)
    const moved = await carryToRevision(tx, fresh, revised, actor.id);
    if (moved.carried.length || moved.released.length) {
      await audit(tx, revised.id, "ALLOCATIONS_MOVED", actor.id, {
        reason,
        after: {
          carried: moved.carried.map((a) => ({ id: a.id, amount: a.amount })),
          released: moved.released.map((r) => ({ id: r.allocation.id, amount: s(r.amount) })),
        },
      });
    }
    return revised;
  });
}
