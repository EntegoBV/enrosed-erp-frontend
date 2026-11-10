import type { DrillColumn, DrillLink, DrillRow, DrillView } from './drill-model';
import { partnerSaleKind, type PartnerSalesFigures } from './partner-sales-analysis';

/*
 * The drills of Verkoop › Veilingverkopen: one row per melding (VV-12) of the
 * period, opened on an additive figure only - stuks, bruto, netto, nog te
 * factureren - so the rows add up to the clicked figure exactly (both come
 * from the same analytics rows; no gap). A product row opens its own
 * meldingen. Every row links to the melding on the Veilingverkopen page.
 * Pure: type imports, plus the kind word of partner-sales-analysis.
 */

export type PartnerSalesFigureKey = 'pieces' | 'gross' | 'net' | 'open';

const LIST: DrillLink = { path: ['/veilingverkopen'] };
const melding = (id: number): DrillLink => ({ path: ['/veilingverkopen'], query: { melding: id } });

const COLUMNS: Readonly<Record<'doc' | 'date' | 'pieces' | 'gross' | 'costs' | 'buyback' | 'net', DrillColumn>> = {
  doc: { key: 'doc', label: 'Melding', format: 'text', phone: 'title' },
  date: { key: 'date', label: 'Verkocht', format: 'day', phone: 'sub' },
  pieces: { key: 'pieces', label: 'Stuks', format: 'int', phone: 'sub', sum: true },
  gross: { key: 'gross', label: 'Bruto', format: 'eur2', phone: 'none', sum: true },
  costs: { key: 'costs', label: 'Kosten', format: 'eur2', phone: 'none', sum: true },
  buyback: { key: 'buyback', label: 'Terugkoop', format: 'eur2', phone: 'none', sum: true },
  net: { key: 'net', label: 'Netto', format: 'eur2', phone: 'none', sum: true },
};

const TITLES: Readonly<Record<PartnerSalesFigureKey, string>> = {
  pieces: 'Veilingverkopen · stuks', gross: 'Veilingverkopen · bruto', net: 'Veilingverkopen · netto', open: 'Veilingverkopen · nog te factureren',
};

/** The columns with the clicked one last, as the dialog's value. */
function columnsFor(value: 'pieces' | 'gross' | 'net'): DrillColumn[] {
  const rest = (['pieces', 'gross', 'costs', 'buyback', 'net'] as const).filter((key) => key !== value).map((key) => COLUMNS[key]);
  return [COLUMNS.doc, COLUMNS.date, ...rest, { ...COLUMNS[value], phone: 'value' }];
}

/** One figure of the card: its meldingen, summing to `figure` (the card's own number from the same rows). */
export function partnerSalesView(key: PartnerSalesFigureKey, figures: PartnerSalesFigures, figure: number, scope: string): DrillView {
  const value = key === 'pieces' ? 'pieces' : key === 'gross' ? 'gross' : 'net';
  const reports = figures.reports.filter((row) => (key === 'open' ? row.open : true)
    && (key === 'pieces' ? row.saleQuantity !== 0 : key === 'gross' ? row.grossEur !== 0 : true));
  const rows: DrillRow[] = reports.map((row) => ({
    key: `vv${row.id}`,
    cells: { doc: `${row.number} · ${partnerSaleKind(row)}`, date: row.soldOn, pieces: row.saleQuantity, gross: row.grossEur,
      costs: row.costsEur, buyback: row.buybackEur, net: row.netEur },
    pill: key !== 'open' && row.open ? 'Open' : null,
    tone: value === 'net' && row.netEur < 0 ? 'danger' : null,
    link: melding(row.id),
  }));
  return {
    id: `sales.partnerSales.${key}`, title: TITLES[key], scope: `${scope} · op verkoopdatum`,
    note: key === 'pieces' ? 'Verkochte stuks in de verkoopeenheid; teruggekochte stuks staan apart.'
      : key === 'gross' ? null : 'Netto = bruto − veilingcommissie, transport en extra kost − terugkoop.',
    columns: columnsFor(value), rows, valueKey: value,
    total: { value: figure, format: value === 'pieces' ? 'int' : 'eur2', of: 'sum' },
    sort: { key: 'date', dir: 'desc' }, empty: key === 'open' ? 'Alles is gefactureerd.' : 'Geen meldingen in deze periode.',
    foot: { label: 'Veilingverkopen ›', link: LIST },
  };
}

/** A product of the card: its meldingen in the period, summing to its bruto. */
export function partnerProductView(productId: number, name: string, figures: PartnerSalesFigures, figure: number, scope: string): DrillView {
  const numbers = new Map(figures.reports.map((row) => [row.id, row] as const));
  const rows: DrillRow[] = figures.productRows.filter((row) => row.productId === productId && row.grossEur !== 0).map((row) => {
    const report = numbers.get(row.reportId);
    return {
      key: `vv${row.reportId}p${row.productId}`,
      cells: { doc: `${report?.number ?? `VV-${row.reportId}`} · ${report ? partnerSaleKind(report) : row.channel === 'DIRECT' ? 'Direct' : 'Veiling'}`,
        date: row.soldOn, pieces: row.saleQuantity, average: row.saleQuantity > 0 ? Math.round(row.grossEur / row.saleQuantity * 10_000) / 10_000 : null,
        gross: row.grossEur },
      pill: row.open ? 'Open' : null,
      link: melding(row.reportId),
    };
  });
  return {
    id: `sales.partnerSales.product.${productId}`, title: name, scope: `${scope} · Veilingverkopen · op verkoopdatum`,
    columns: [COLUMNS.doc, COLUMNS.date, COLUMNS.pieces, { key: 'average', label: 'Gem. prijs', format: 'eur4', phone: 'none' },
      { ...COLUMNS.gross, phone: 'value' }],
    rows, valueKey: 'gross', total: { value: figure, format: 'eur2', of: 'sum' },
    sort: { key: 'date', dir: 'desc' }, empty: 'Geen meldingen van dit product in deze periode.',
    foot: { label: 'Product openen ›', link: { path: ['/products', productId] } },
  };
}
