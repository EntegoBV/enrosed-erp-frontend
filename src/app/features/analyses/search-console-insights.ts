import type { GoogleAnalyticsSource, GoogleSearchData, SearchPerformance } from '../../core/api/analytics-api';

/** Review thresholds, not Google benchmarks or proof of an SEO cause. */
export const SEARCH_INSIGHT_THRESHOLDS = Object.freeze({
  minimumImpressions: 100, minimumPageImpressions: 100,
  lowCtr: .01, nearFirstPageFrom: 10, nearFirstPageThrough: 20,
  minimumPreviousClicks: 10, clickDeclinePercent: -20,
});

export type SearchInsightPriority = 'focus' | 'watch' | 'info';
export interface SearchInsight {
  id: string; priority: SearchInsightPriority; title: string; explanation: string; evidence: string[];
  action: { label: string; routerLink?: string; href?: string };
}
interface CountChange { current: number; previous: number; delta: number; percent: number | null; }
export interface SearchTrend {
  from: string; to: string; previousFrom: string; previousTo: string;
  clicks: CountChange; impressions: CountChange;
  ctr: { current: number; previous: number; percentagePoints: number | null };
  position: { current: number; previous: number; delta: number | null; direction: 'better' | 'worse' | 'flat' | null };
}
export interface SearchLanguageSummary {
  locale: string; label: string; clicks: number | null; impressions: number | null;
  ctr: number | null; position: number | null; reportedPages: number;
  coverage: 'reported-pages' | 'unavailable';
}
interface QueryBucket { queries: number; clicks: number; impressions: number; }
export interface SearchQueryMix {
  branded: QueryBucket; wholesale: QueryBucket; other: QueryBucket;
  reportedQueries: number; scope: 'returned-queries';
}
export interface SearchConsoleInsights {
  summary: string; lowVolume: boolean; stale: boolean; insights: SearchInsight[]; limitations: string[];
  trend: SearchTrend | null; languages: SearchLanguageSummary[]; queryMix: SearchQueryMix | null;
}

const locales = [
  ['en', 'Engels'], ['nl', 'Nederlands'], ['fr', 'Frans'], ['de', 'Duits'], ['es', 'Spaans'],
  ['pl', 'Pools'], ['pt', 'Portugees'], ['el', 'Grieks'], ['tr', 'Turks'],
] as const;
const number = (value: number, decimals = 0) => new Intl.NumberFormat('nl-BE', { maximumFractionDigits: decimals }).format(value);
const clicks = (value: number) => `${number(value)} ${value === 1 ? 'klik' : 'klikken'}`;
const percent = (value: number) => `${number(value * 100, 1)} %`;
const seoAction = { label: 'SEO-inhoud bekijken', routerLink: '/website/seo' };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const performanceValid = (row: SearchPerformance | null | undefined): row is SearchPerformance => !!row
  && [row.clicks, row.impressions, row.ctr, row.position].every(finite) && row.ctr <= 1;
const hasIssue = (data: GoogleSearchData, section: string): boolean => (data.issues ?? [])
  .some(issue => typeof issue.section === 'string' && issue.section.toLowerCase().includes(section));

export function searchInsightPriorityLabel(priority: SearchInsightPriority): string {
  return ({ focus: 'Eerst bekijken', watch: 'Volgen', info: 'Ter informatie' })[priority];
}

/** Strip query/fragment data and never turn a reporting value into an arbitrary link. */
export function searchConsolePageLink(value: string): string | null {
  if (!value || (!value.startsWith('/') && !/^https?:\/\//i.test(value))) return null;
  try {
    const url = new URL(value, 'https://enrosed.com');
    if (!['enrosed.com', 'www.enrosed.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return `https://${url.hostname}${url.pathname}`;
  } catch { return null; }
}

function localeForPage(page: string): string | null {
  const href = searchConsolePageLink(page);
  if (!href) return null;
  const path = new URL(href).pathname;
  const first = path.split('/')[1].toLowerCase();
  if (locales.some(([locale]) => locale === first)) return first;
  // Unknown/historical paths are not evidence that their content was English.
  return !first || ['products', 'collections', 'quote', 'contact', 'wholesale', 'legal'].includes(first) ? 'en' : null;
}

function languageRows(data: GoogleSearchData | null): SearchLanguageSummary[] {
  const pages = data && !hasIssue(data, 'page') && Array.isArray(data.pages)
    ? data.pages.filter(row => performanceValid(row) && typeof row.page === 'string') : [];
  return locales.map(([locale, label]) => {
    const rows = pages.filter(row => localeForPage(row.page) === locale);
    if (!rows.length) return { locale, label, clicks: null, impressions: null, ctr: null, position: null,
      reportedPages: 0, coverage: 'unavailable' };
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    return { locale, label, clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null,
      position: impressions > 0 ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : null,
      reportedPages: rows.length, coverage: 'reported-pages' };
  });
}

function queryMix(data: GoogleSearchData): SearchQueryMix | null {
  if (hasIssue(data, 'quer') || !Array.isArray(data.queries) || !data.queries.length) return null;
  const bucket = (): QueryBucket => ({ queries: 0, clicks: 0, impressions: 0 });
  const result: SearchQueryMix = { branded: bucket(), wholesale: bucket(), other: bucket(), reportedQueries: 0, scope: 'returned-queries' };
  for (const row of data.queries.filter(performanceValid)) {
    if (typeof row.query !== 'string' || !row.query.trim()) continue;
    const text = row.query.trim().toLocaleLowerCase('nl-BE');
    // Search operators and long diagnostic queries are not buyer-intent evidence.
    const diagnostic = text.length > 120 || /(?:^|\s)(?:site|inurl|intitle|allintitle|cache|filetype|related):|https?:\/\//.test(text);
    const key = !diagnostic && /\benrosed\b/.test(text) ? 'branded'
      : !diagnostic && /\b(?:wholesale\w*|groothandel\w*|grosshandel\w*|großhandel\w*|grossiste\w*|mayorista\w*|hurtown\w*|hurtow\w*|atacado\w*|grossista\w*|toptan\w*)\b|al por mayor|en gros|χονδρικ/iu.test(text) ? 'wholesale' : 'other';
    result[key].queries++; result[key].clicks += row.clicks; result[key].impressions += row.impressions; result.reportedQueries++;
  }
  return result.reportedQueries ? result : null;
}

function day(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / 86_400_000 : null;
}

function comparison(source: GoogleAnalyticsSource<GoogleSearchData>, data: GoogleSearchData): SearchTrend | null {
  const previous = data.comparison;
  if (!['GOOGLE_FINAL_BOUNDARY', 'LATEST_REPORTED_FINAL_DAY'].includes(data.periodBasis ?? '') || !previous || !['CONNECTED', 'NO_DATA'].includes(previous.status)
    || !performanceValid(previous.totals)) return null;
  const [start, end, priorStart, priorEnd] = [source.from, source.to, previous.from, previous.to].map(day);
  if (start === null || end === null || priorStart === null || priorEnd === null || end < start || priorEnd < priorStart
    || end - start !== priorEnd - priorStart || priorEnd + 1 !== start) return null;
  const count = (current: number, old: number): CountChange => ({ current, previous: old, delta: current - old,
    percent: old > 0 ? (current - old) / old * 100 : null });
  const current = data.totals, old = previous.totals;
  const ratesKnown = current.impressions > 0 && old.impressions > 0;
  const positionDelta = ratesKnown && current.position > 0 && old.position > 0 ? current.position - old.position : null;
  return { from: source.from!, to: source.to!, previousFrom: previous.from!, previousTo: previous.to!,
    clicks: count(current.clicks, old.clicks), impressions: count(current.impressions, old.impressions),
    ctr: { current: current.ctr, previous: old.ctr, percentagePoints: ratesKnown ? (current.ctr - old.ctr) * 100 : null },
    position: { current: current.position, previous: old.position, delta: positionDelta,
      direction: positionDelta === null ? null : Math.abs(positionDelta) < .0000001 ? 'flat' : positionDelta < 0 ? 'better' : 'worse' },
  };
}

export function deriveSearchConsoleInsights(source: GoogleAnalyticsSource<GoogleSearchData> | null | undefined): SearchConsoleInsights {
  const empty = (summary: string): SearchConsoleInsights => ({ summary, lowVolume: false, stale: false, insights: [],
    limitations: [], trend: null, languages: languageRows(null), queryMix: null });
  if (!source || source.status === 'ERROR') return empty('Zoekcijfers zijn momenteel niet beschikbaar.');
  if (source.status === 'NOT_CONFIGURED') return empty('Search Console is nog niet gekoppeld.');
  if (!['CONNECTED', 'NO_DATA', 'STALE'].includes(source.status) || !performanceValid(source.data?.totals)) {
    return empty('Er zijn nog geen betrouwbare zoekcijfers om te beoordelen.');
  }
  const data = source.data!, totals = data.totals;
  const lowVolume = totals.impressions < SEARCH_INSIGHT_THRESHOLDS.minimumImpressions;
  const result: SearchConsoleInsights = {
    summary: totals.impressions === 0 ? 'Google rapporteert voor deze periode nog geen vertoningen.'
      : `${clicks(totals.clicks)} uit ${number(totals.impressions)} vertoningen in Google${lowVolume ? '; nog weinig gegevens voor conclusies' : ''}.`,
    lowVolume, stale: source.status === 'STALE', insights: [], trend: comparison(source, data),
    languages: languageRows(data), queryMix: queryMix(data),
    limitations: ['Signaalgrenzen helpen kiezen wat u nakijkt; het zijn geen Google-normen en ze bewijzen geen SEO-oorzaak.',
      'Talen zijn afgeleid van de gerapporteerde pagina-URL’s, niet van de taal van bezoekers. Ontbrekende talen hebben onbekende cijfers.',
      'Pagina- en zoektermlijsten zijn beperkt. Anonieme of niet-teruggegeven zoektermen ontbreken; hun som is niet het sitetotaal.'],
  };
  if (result.stale) result.limitations.unshift('Dit rapport is eerder opgehaald; vernieuwen is niet gelukt.');
  result.limitations.push('Het rapport kan historische URL’s bevatten. Controleer hun huidige bestemming voordat u inhoud aanpast; ook de taalindeling van oude URL’s kan afwijken.');
  if (data.periodBasis === 'UNCONFIRMED') result.limitations.push('De definitieve periodegrens is niet bevestigd; daarom wordt geen trend berekend.');
  else if (data.comparison && !result.trend) result.limitations.push('Er is geen bruikbare vergelijking met een even lange voorafgaande periode.');
  if (data.issues?.length) result.limitations.push('Een deelrapport ontbreekt. Daaruit worden geen aanbevelingen of nulwaarden afgeleid.');
  const trend = result.trend;
  if (trend && trend.clicks.previous >= SEARCH_INSIGHT_THRESHOLDS.minimumPreviousClicks && trend.clicks.percent !== null) {
    const days = day(trend.to)! - day(trend.from)! + 1;
    result.summary = `${clicks(totals.clicks)}: ${Math.abs(trend.clicks.percent) < .05 ? 'vrijwel evenveel als' : `${number(Math.abs(trend.clicks.percent), 1)}% ${trend.clicks.percent > 0 ? 'meer' : 'minder'} dan`} in de vorige ${days} dagen.`;
  }
  const mix = result.queryMix;
  if (mix && mix.branded.clicks > 0 && mix.branded.clicks <= totals.clicks && mix.branded.clicks >= totals.clicks * .5) {
    result.summary += ` Minstens ${percent(mix.branded.clicks / totals.clicks)} komt via herkenbare merkzoektermen.`;
  }
  // A confirmed fall to zero is useful evidence, even though the current period
  // alone would be too small for page-level CTR recommendations.
  if (trend && trend.clicks.previous >= SEARCH_INSIGHT_THRESHOLDS.minimumPreviousClicks
    && trend.impressions.previous >= SEARCH_INSIGHT_THRESHOLDS.minimumImpressions
    && trend.clicks.percent !== null && trend.clicks.percent <= SEARCH_INSIGHT_THRESHOLDS.clickDeclinePercent) {
    result.insights.push({ id: 'click-decline', priority: 'watch', title: 'Onderzoek de daling in klikken',
      explanation: 'Vergelijk de gerapporteerde pagina’s en zoektermen met een eerdere export. Deze daling op zichzelf toont geen technische fout of algoritmewijziging aan.',
      evidence: [`${number(trend.clicks.previous)} → ${number(trend.clicks.current)} klikken (${number(trend.clicks.percent, 1)}%).`,
        `Vergelijking met ${trend.previousFrom} – ${trend.previousTo}; evenlange aansluitende periodes.`,
        'Signaalgrens: minstens 10 eerdere klikken en een daling van 20%.'], action: seoAction });
  }
  if (lowVolume) {
    result.insights.push({ id: 'low-volume', priority: 'info', title: 'Eerst meer waarnemingen verzamelen',
      explanation: 'Bij weinig vertoningen kunnen enkele klikken de klikratio sterk veranderen. Vergelijk later een langere periode voordat u hieruit een inhoudelijke conclusie trekt.',
      evidence: [`${number(totals.impressions)} vertoningen; signaalgrens: minstens ${SEARCH_INSIGHT_THRESHOLDS.minimumImpressions}.`], action: seoAction });
    return result;
  }
  const pages = hasIssue(data, 'page') || !Array.isArray(data.pages) ? [] : data.pages.filter(row => performanceValid(row) && typeof row.page === 'string' && searchConsolePageLink(row.page)
    && row.impressions >= SEARCH_INSIGHT_THRESHOLDS.minimumPageImpressions).sort((a, b) => b.impressions - a.impressions);
  const lowCtr = pages.find(row => row.ctr < SEARCH_INSIGHT_THRESHOLDS.lowCtr && row.position > 0 && row.position <= 10);
  if (lowCtr) result.insights.push({ id: 'low-ctr', priority: 'focus', title: 'Controleer de zoekweergave van deze pagina',
    explanation: 'Controleer eerst de huidige bestemming: dit kan een historische URL zijn. Bekijk vervolgens of titel en omschrijving aansluiten op het aanbod. De cijfers bewijzen niet waarom mensen wel of niet doorklikken.',
    evidence: [searchConsolePageLink(lowCtr.page)!, `${clicks(lowCtr.clicks)} uit ${number(lowCtr.impressions)} vertoningen · CTR ${percent(lowCtr.ctr)} · gemiddelde positie ${number(lowCtr.position, 1)}.`,
      'Signaalgrens: minstens 100 vertoningen, CTR onder 1% en gemiddelde positie 1–10.'], action: seoAction });
  const near = pages.find(row => row.position > SEARCH_INSIGHT_THRESHOLDS.nearFirstPageFrom && row.position <= SEARCH_INSIGHT_THRESHOLDS.nearFirstPageThrough);
  if (near) result.insights.push({ id: 'near-first-page', priority: 'watch', title: 'Bekijk deze pagina met gemiddelde positie 10–20',
    explanation: 'Controleer eerst de huidige bestemming: dit kan een historische URL zijn. Bekijk daar de productinformatie en interne verwijzingen voor inkopers. Een gemiddelde positie is geen vaste ranking of garantie op een eerste pagina.',
    evidence: [searchConsolePageLink(near.page)!, `${number(near.impressions)} vertoningen · gemiddelde positie ${number(near.position, 1)}.`,
      'Signaalgrens: minstens 100 vertoningen en gemiddelde positie boven 10 tot en met 20.'],
    action: { label: 'Pagina bekijken', href: searchConsolePageLink(near.page)! } });
  if (mix && mix.branded.clicks > 0 && mix.branded.clicks <= totals.clicks && mix.branded.clicks >= totals.clicks * .5) {
    result.insights.push({ id: 'brand-discovery', priority: 'info', title: 'Volg merknaam en groothandelsvragen apart',
      explanation: 'Herkenbare merkzoektermen tonen vraag naar Enrosed. Bekijk daarnaast de gerapporteerde groothandelstermen; ontbrekende zoektermen zeggen niets over niet-gerapporteerde vraag.',
      evidence: [`Minstens ${number(mix.branded.clicks)} van ${number(totals.clicks)} klikken (${percent(mix.branded.clicks / totals.clicks)}) komen uit herkenbare merkzoektermen.`,
        `${mix.reportedQueries} gerapporteerde zoektermen; woordherkenning is beperkt.`,
        ...(mix.wholesale.queries ? [`${clicks(mix.wholesale.clicks)} uit ${number(mix.wholesale.impressions)} vertoningen bij herkende groothandelstermen in deze lijst.`] : [])], action: seoAction });
  }
  const priority = { focus: 0, watch: 1, info: 2 };
  result.insights = result.insights.sort((a, b) => priority[a.priority] - priority[b.priority]).slice(0, 4);
  return result;
}
