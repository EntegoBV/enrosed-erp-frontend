/**
 * Stock batches on the product page (2026-10-25, batches contract §7.2): the
 * texts of the Batches card (desk), the Batches section (phone) and the batch
 * sheet, apart from the screen. Only `import type` from src, so node tests load
 * it directly; unit words and euro text come in as a BatchFormat.
 */
import type { ProductStockBatches, StockBatch, StockBatchMove, StockBatchMoveKind } from '../../core/api/stock-batch-models';
import type { BatchFormat } from '../../core/api/stock-batch-units';

const COUNT = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DATE_UTC = new Intl.DateTimeFormat('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

/** "20/08/2026" from a date ("2026-08-20") or an instant; '' without one. */
export function batchDate(value: string | null | undefined): string {
  if (!value) return '';
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = day ? new Date(Date.UTC(+day[1], +day[2] - 1, +day[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (day ? DATE_UTC : DATE).format(date);
}

/** The container's Herkenbare naam (else its number); "Beginvoorraad"; "Telling". */
export function batchTitle(b: Pick<StockBatch, 'kind' | 'containerName' | 'orderNumber'>): string {
  if (b.kind === 'OPENING') return 'Beginvoorraad';
  if (b.kind === 'COUNT') return 'Telling';
  return b.containerName?.trim() || b.orderNumber?.trim() || 'Container';
}

/** In order: volgende · partner · berekend | van productkaart | kost onbekend. */
export function batchTags(b: StockBatch): string[] {
  const tags: string[] = [];
  if (b.next) tags.push('volgende');
  if (b.owner === 'PARTNER') tags.push('partner');
  if (b.costState === 'CALCULATED') tags.push('berekend');
  else if (b.costState === 'CARD') tags.push('van productkaart');
  else if (b.costState === 'NONE') tags.push('kost onbekend');
  return tags;
}

/** "20/08/2026 · nog 105 van 500"; Beginvoorraad "bij de start · nog 40 van 40"; Telling "{datum} · nog 4 van 4". */
export function batchSub(b: StockBatch, fmt: BatchFormat): string {
  const left = `nog ${fmt.count(b.piecesLeft, b.unitPieces)} van ${fmt.count(b.piecesIn, b.unitPieces)}`;
  const when = b.kind === 'OPENING' ? 'bij de start' : batchDate(b.receivedOn ?? b.bookedAt);
  return when ? `${when} · ${left}` : left;
}

/** "10,39": a euro figure without its sign, for the arrow of a stale cost. */
function bare(text: string): string {
  return text.replace(/^€[\s  ]*/, '');
}

/** The cost and, for a stale batch, today's calculation: { cost: "€ 8,32", now: "→ 10,39" }; without cost "—". */
export function batchCostParts(b: StockBatch, fmt: BatchFormat): { cost: string; now: string | null } {
  if (b.unitCostEur === null || b.unitCostEur === undefined) return { cost: '—', now: null };
  const now = b.stale && b.calcUnitEur !== null && b.calcUnitEur !== undefined ? `→ ${bare(fmt.eur(b.calcUnitEur))}` : null;
  return { cost: fmt.eur(b.unitCostEur), now };
}

/** "€ 8,32"; stale "€ 8,32 → 10,39"; without cost "—". */
export function batchCostText(b: StockBatch, fmt: BatchFormat): string {
  const { cost, now } = batchCostParts(b, fmt);
  return now ? `${cost} ${now}` : cost;
}

/** Live batches (pieces left) and sold-out ones, each in the server's order. */
export function splitBatches(list: readonly StockBatch[]): { active: StockBatch[]; empty: StockBatch[] } {
  return { active: list.filter((b) => b.piecesLeft > 0), empty: list.filter((b) => b.piecesLeft <= 0) };
}

/** Only after the start, and only with something to show. */
export function showBatches(data: ProductStockBatches | null): boolean {
  if (!data || !data.started) return false;
  return data.batches.length > 0 || data.summary.unassignedPieces !== 0 || data.summary.differencePieces !== 0;
}

/** "Oudste gaat eerst · in displays", + " · partner € 120 apart". */
export function batchesHelper(data: ProductStockBatches, fmt: BatchFormat): string {
  const partner = data.summary.partnerValueEur > 0 ? ` · partner ${fmt.eur(data.summary.partnerValueEur, 0)} apart` : '';
  return `Oudste gaat eerst · in ${fmt.unit.plural}${partner}`;
}

function piecesWord(n: number): string {
  return `${COUNT.format(n)} ${n === 1 ? 'stuk' : 'stuks'}`;
}

/** The first that applies: pieces without batch · a difference with the stock · batches without cost · null. */
export function batchesNote(data: ProductStockBatches, fmt: BatchFormat): string | null {
  const { unassignedPieces, differencePieces } = data.summary;
  if (unassignedPieces > 0) return `${fmt.units(unassignedPieces, data.unitPieces)} zonder batch`;
  if (differencePieces !== 0) return `Batches wijken ${piecesWord(Math.abs(differencePieces))} af van de voorraad`;
  const noCost = data.batches.filter((b) => b.piecesLeft > 0 && (b.unitCostEur === null || b.unitCostEur === undefined)).length;
  if (noCost > 0) return `${COUNT.format(noCost)} ${noCost === 1 ? 'batch' : 'batches'} zonder kost`;
  return null;
}

/** "Partner € 120 niet in het totaal" | null. */
export function partnerFoot(data: ProductStockBatches, fmt: BatchFormat): string | null {
  return data.summary.partnerValueEur > 0 ? `Partner ${fmt.eur(data.summary.partnerValueEur, 0)} niet in het totaal` : null;
}

/** Ontvangen, Verkocht, Verlies, Vóór de start (only above 0), Nog. */
export function batchFigures(b: StockBatch, fmt: BatchFormat): { label: string; value: string }[] {
  const figures = [
    { label: 'Ontvangen', value: fmt.units(b.piecesIn, b.unitPieces) },
    { label: 'Verkocht', value: fmt.units(b.soldPieces, b.unitPieces) },
    { label: 'Verlies', value: fmt.units(b.lostPieces, b.unitPieces) },
  ];
  if (b.earlierPieces > 0) figures.push({ label: 'Vóór de start', value: fmt.units(b.earlierPieces, b.unitPieces) });
  figures.push({ label: 'Nog', value: fmt.units(b.piecesLeft, b.unitPieces) });
  return figures;
}

/** "Toegepast 23/08/2026" · "Berekend" · "Van de productkaart" · "Kost onbekend". */
export function batchStateWord(b: Pick<StockBatch, 'costState' | 'costAppliedAt'>): string {
  switch (b.costState) {
    case 'APPLIED': {
      const date = batchDate(b.costAppliedAt);
      return date ? `Toegepast ${date}` : 'Toegepast';
    }
    case 'CALCULATED': return 'Berekend';
    case 'CARD': return 'Van de productkaart';
    default: return 'Kost onbekend';
  }
}

/** The row's full text as a title: "€ 8,32 → 10,39 per display · Toegepast 23/08/2026". */
export function batchRowTitle(b: StockBatch, fmt: BatchFormat): string {
  return `${batchCostText(b, fmt)} per ${fmt.unit.singular} · ${batchStateWord(b)}`;
}

/** The cost-fix drift line of a stale batch: "{PO} rekent nu € 10,39 per display (+ € 2,07)"; null when not stale. */
export function batchDrift(b: StockBatch, fmt: BatchFormat): { text: string; orderId: number } | null {
  if (!b.stale || b.purchaseOrderId === null || b.containerGone || b.unitCostEur === null || b.calcUnitEur === null) return null;
  const difference = Math.round((Math.round(b.calcUnitEur * 100) - Math.round(b.unitCostEur * 100))) / 100;
  const sign = difference >= 0 ? '+' : '−';
  const order = b.orderNumber?.trim() || batchTitle(b);
  return {
    text: `${order} rekent nu ${fmt.eur(b.calcUnitEur)} per ${fmt.unit.singular} (${sign}\u00a0${fmt.eur(Math.abs(difference))})`,
    orderId: b.purchaseOrderId,
  };
}

const MOVE_LABELS: Record<StockBatchMoveKind, string> = {
  PURCHASE_RECEIPT: 'Ontvangen',
  RECEIPT_CORRECTION: 'Ontvangst gecorrigeerd',
  OPENING: 'Beginvoorraad',
  COUNT_IN: 'Gevonden',
  BACKFILL: 'Weg vóór de start',
  REPAIR: 'Hersteld',
  SALE: 'Verkocht',
  SALE_RETURN: 'Retour',
  DAMAGED: 'Beschadigd',
  SHORTAGE: 'Te weinig geleverd',
  DEMO: 'Demo',
  STOCKTAKE: 'Telling',
  MANUAL_CORRECTION: 'Manueel gezet',
};

/** The move's kind in words, + " · eerder zonder batch" (settles) and " · boeking verwijderd" (movementGone). */
export function moveLabel(m: StockBatchMove): string {
  let label = MOVE_LABELS[m.kind] ?? m.kind;
  if (m.settles) label += ' · eerder zonder batch';
  if (m.movementGone) label += ' · boeking verwijderd';
  return label;
}

/** "−20", "+4 los", "+1 + 2 los": the signed count in the move's own unit. */
export function moveDelta(m: StockBatchMove, fmt: BatchFormat): string {
  const count = fmt.count(m.pieces, m.unitPieces);
  return m.pieces > 0 ? `+${count}` : count;
}
