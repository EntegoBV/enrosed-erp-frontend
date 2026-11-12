/**
 * Reference lists for countries and ports.
 *
 * Kept as plain constants rather than a backend table: ISO codes do not
 * change, nobody needs to edit them, and a settings screen for them would be
 * one more thing to maintain. The backend stores only the chosen code.
 *
 * Names are in Dutch because this is our internal tool; what the customer
 * sees is translated elsewhere.
 */
export interface IsoCountry {
  code: string;
  name: string;
  /** Other spellings people type ("Saudi", "UK", "Holland"); searched, never shown. */
  aliases?: string[];
}

/*
 * Every ISO 3166-1 alpha-2 country (plus Kosovo's XK, which the EU and the
 * carriers use), grouped by continent for the reader; the exported list is
 * sorted by Dutch name below. Dutch names as the Dutch Wikipedia and the
 * Belgian government spell them.
 */
const COUNTRIES: IsoCountry[] = [
  // Europe
  { code: 'AD', name: 'Andorra' },
  { code: 'AL', name: 'Albanië', aliases: ['Albania'] },
  { code: 'AT', name: 'Oostenrijk', aliases: ['Austria', 'Österreich'] },
  { code: 'AX', name: 'Åland' },
  { code: 'BA', name: 'Bosnië en Herzegovina', aliases: ['Bosnia'] },
  { code: 'BE', name: 'België', aliases: ['Belgium', 'Belgique', 'Belgien'] },
  { code: 'BG', name: 'Bulgarije', aliases: ['Bulgaria'] },
  { code: 'BY', name: 'Belarus', aliases: ['Wit-Rusland'] },
  { code: 'CH', name: 'Zwitserland', aliases: ['Switzerland', 'Schweiz', 'Suisse'] },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Tsjechië', aliases: ['Czechia', 'Czech Republic', 'Tsjechische Republiek'] },
  { code: 'DE', name: 'Duitsland', aliases: ['Germany', 'Deutschland'] },
  { code: 'DK', name: 'Denemarken', aliases: ['Denmark', 'Danmark'] },
  { code: 'EE', name: 'Estland', aliases: ['Estonia'] },
  { code: 'ES', name: 'Spanje', aliases: ['Spain', 'España'] },
  { code: 'FI', name: 'Finland', aliases: ['Suomi'] },
  { code: 'FO', name: 'Faeröer', aliases: ['Faroe Islands'] },
  { code: 'FR', name: 'Frankrijk', aliases: ['France'] },
  { code: 'GB', name: 'Verenigd Koninkrijk', aliases: ['UK', 'United Kingdom', 'Engeland', 'Groot-Brittannië', 'England', 'Great Britain'] },
  { code: 'GG', name: 'Guernsey' },
  { code: 'GI', name: 'Gibraltar' },
  { code: 'GR', name: 'Griekenland', aliases: ['Greece', 'Hellas'] },
  { code: 'HR', name: 'Kroatië', aliases: ['Croatia', 'Hrvatska'] },
  { code: 'HU', name: 'Hongarije', aliases: ['Hungary', 'Magyarország'] },
  { code: 'IE', name: 'Ierland', aliases: ['Ireland', 'Eire'] },
  { code: 'IM', name: 'Man', aliases: ['Isle of Man'] },
  { code: 'IS', name: 'IJsland', aliases: ['Iceland'] },
  { code: 'IT', name: 'Italië', aliases: ['Italy', 'Italia'] },
  { code: 'JE', name: 'Jersey' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Litouwen', aliases: ['Lithuania'] },
  { code: 'LU', name: 'Luxemburg', aliases: ['Luxembourg'] },
  { code: 'LV', name: 'Letland', aliases: ['Latvia'] },
  { code: 'MC', name: 'Monaco' },
  { code: 'MD', name: 'Moldavië', aliases: ['Moldova'] },
  { code: 'ME', name: 'Montenegro' },
  { code: 'MK', name: 'Noord-Macedonië', aliases: ['Macedonië', 'North Macedonia'] },
  { code: 'MT', name: 'Malta' },
  { code: 'NL', name: 'Nederland', aliases: ['Holland', 'Netherlands', 'The Netherlands'] },
  { code: 'NO', name: 'Noorwegen', aliases: ['Norway', 'Norge'] },
  { code: 'PL', name: 'Polen', aliases: ['Poland', 'Polska'] },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Roemenië', aliases: ['Romania', 'România'] },
  { code: 'RS', name: 'Servië', aliases: ['Serbia'] },
  { code: 'RU', name: 'Rusland', aliases: ['Russia'] },
  { code: 'SE', name: 'Zweden', aliases: ['Sweden', 'Sverige'] },
  { code: 'SI', name: 'Slovenië', aliases: ['Slovenia'] },
  { code: 'SJ', name: 'Spitsbergen en Jan Mayen', aliases: ['Svalbard'] },
  { code: 'SK', name: 'Slovakije', aliases: ['Slovakia', 'Slowakije'] },
  { code: 'SM', name: 'San Marino' },
  { code: 'UA', name: 'Oekraïne', aliases: ['Ukraine'] },
  { code: 'VA', name: 'Vaticaanstad', aliases: ['Vatican', 'Heilige Stoel'] },
  { code: 'XK', name: 'Kosovo' },
  // Middle East and Asia
  { code: 'AE', name: 'Verenigde Arabische Emiraten', aliases: ['VAE', 'UAE', 'Dubai', 'Emiraten', 'United Arab Emirates', 'Abu Dhabi'] },
  { code: 'AF', name: 'Afghanistan' },
  { code: 'AM', name: 'Armenië', aliases: ['Armenia'] },
  { code: 'AZ', name: 'Azerbeidzjan', aliases: ['Azerbaijan'] },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BH', name: 'Bahrein', aliases: ['Bahrain'] },
  { code: 'BN', name: 'Brunei' },
  { code: 'BT', name: 'Bhutan' },
  { code: 'CN', name: 'China', aliases: ['PRC', 'Volksrepubliek China'] },
  { code: 'GE', name: 'Georgië', aliases: ['Georgia'] },
  { code: 'HK', name: 'Hongkong', aliases: ['Hong Kong'] },
  { code: 'ID', name: 'Indonesië', aliases: ['Indonesia'] },
  { code: 'IL', name: 'Israël', aliases: ['Israel'] },
  { code: 'IN', name: 'India' },
  { code: 'IQ', name: 'Irak', aliases: ['Iraq'] },
  { code: 'IR', name: 'Iran' },
  { code: 'JO', name: 'Jordanië', aliases: ['Jordan'] },
  { code: 'JP', name: 'Japan' },
  { code: 'KG', name: 'Kirgizië', aliases: ['Kyrgyzstan', 'Kirgizstan'] },
  { code: 'KH', name: 'Cambodja', aliases: ['Cambodia'] },
  { code: 'KP', name: 'Noord-Korea', aliases: ['North Korea'] },
  { code: 'KR', name: 'Zuid-Korea', aliases: ['Korea', 'South Korea'] },
  { code: 'KW', name: 'Koeweit', aliases: ['Kuwait'] },
  { code: 'KZ', name: 'Kazachstan', aliases: ['Kazakhstan'] },
  { code: 'LA', name: 'Laos' },
  { code: 'LB', name: 'Libanon', aliases: ['Lebanon'] },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'MM', name: 'Myanmar', aliases: ['Birma', 'Burma'] },
  { code: 'MN', name: 'Mongolië', aliases: ['Mongolia'] },
  { code: 'MO', name: 'Macau', aliases: ['Macao'] },
  { code: 'MV', name: 'Maldiven', aliases: ['Maldives'] },
  { code: 'MY', name: 'Maleisië', aliases: ['Malaysia'] },
  { code: 'NP', name: 'Nepal' },
  { code: 'OM', name: 'Oman' },
  { code: 'PH', name: 'Filipijnen', aliases: ['Philippines', 'Filippijnen'] },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PS', name: 'Palestina', aliases: ['Palestine'] },
  { code: 'QA', name: 'Qatar', aliases: ['Katar', 'Doha'] },
  { code: 'SA', name: 'Saoedi-Arabië', aliases: ['Saudi Arabia', 'Saudi', 'KSA', 'Saudi-Arabië', 'Riyad'] },
  { code: 'SG', name: 'Singapore' },
  { code: 'SY', name: 'Syrië', aliases: ['Syria'] },
  { code: 'TH', name: 'Thailand' },
  { code: 'TJ', name: 'Tadzjikistan', aliases: ['Tajikistan'] },
  { code: 'TL', name: 'Oost-Timor', aliases: ['Timor-Leste', 'East Timor'] },
  { code: 'TM', name: 'Turkmenistan' },
  { code: 'TR', name: 'Turkije', aliases: ['Turkey', 'Türkiye'] },
  { code: 'TW', name: 'Taiwan' },
  { code: 'UZ', name: 'Oezbekistan', aliases: ['Uzbekistan'] },
  { code: 'VN', name: 'Vietnam', aliases: ['Viet Nam'] },
  { code: 'YE', name: 'Jemen', aliases: ['Yemen'] },
  // Africa
  { code: 'AO', name: 'Angola' },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' },
  { code: 'BJ', name: 'Benin' },
  { code: 'BW', name: 'Botswana' },
  { code: 'CD', name: 'Congo-Kinshasa', aliases: ['DR Congo', 'Democratische Republiek Congo', 'DRC'] },
  { code: 'CF', name: 'Centraal-Afrikaanse Republiek', aliases: ['Central African Republic'] },
  { code: 'CG', name: 'Congo-Brazzaville', aliases: ['Republiek Congo'] },
  { code: 'CI', name: 'Ivoorkust', aliases: ['Ivory Coast', "Côte d'Ivoire"] },
  { code: 'CM', name: 'Kameroen', aliases: ['Cameroon', 'Cameroun'] },
  { code: 'CV', name: 'Kaapverdië', aliases: ['Cape Verde', 'Cabo Verde'] },
  { code: 'DJ', name: 'Djibouti' },
  { code: 'DZ', name: 'Algerije', aliases: ['Algeria', 'Algérie'] },
  { code: 'EG', name: 'Egypte', aliases: ['Egypt'] },
  { code: 'EH', name: 'Westelijke Sahara', aliases: ['Western Sahara'] },
  { code: 'ER', name: 'Eritrea' },
  { code: 'ET', name: 'Ethiopië', aliases: ['Ethiopia'] },
  { code: 'GA', name: 'Gabon' },
  { code: 'GH', name: 'Ghana' },
  { code: 'GM', name: 'Gambia' },
  { code: 'GN', name: 'Guinee', aliases: ['Guinea'] },
  { code: 'GQ', name: 'Equatoriaal-Guinea', aliases: ['Equatorial Guinea'] },
  { code: 'GW', name: 'Guinee-Bissau', aliases: ['Guinea-Bissau'] },
  { code: 'IO', name: 'Brits Indische Oceaanterritorium', aliases: ['British Indian Ocean Territory'] },
  { code: 'KE', name: 'Kenia', aliases: ['Kenya'] },
  { code: 'KM', name: 'Comoren', aliases: ['Comoros'] },
  { code: 'LR', name: 'Liberia' },
  { code: 'LS', name: 'Lesotho' },
  { code: 'LY', name: 'Libië', aliases: ['Libya'] },
  { code: 'MA', name: 'Marokko', aliases: ['Morocco', 'Maroc'] },
  { code: 'MG', name: 'Madagaskar', aliases: ['Madagascar'] },
  { code: 'ML', name: 'Mali' },
  { code: 'MR', name: 'Mauritanië', aliases: ['Mauritania'] },
  { code: 'MU', name: 'Mauritius' },
  { code: 'MW', name: 'Malawi' },
  { code: 'MZ', name: 'Mozambique' },
  { code: 'NA', name: 'Namibië', aliases: ['Namibia'] },
  { code: 'NE', name: 'Niger' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'RE', name: 'Réunion' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'SC', name: 'Seychellen', aliases: ['Seychelles'] },
  { code: 'SD', name: 'Soedan', aliases: ['Sudan'] },
  { code: 'SH', name: 'Sint-Helena, Ascension en Tristan da Cunha', aliases: ['Saint Helena'] },
  { code: 'SL', name: 'Sierra Leone' },
  { code: 'SN', name: 'Senegal' },
  { code: 'SO', name: 'Somalië', aliases: ['Somalia'] },
  { code: 'SS', name: 'Zuid-Soedan', aliases: ['South Sudan'] },
  { code: 'ST', name: 'Sao Tomé en Principe', aliases: ['São Tomé and Príncipe'] },
  { code: 'SZ', name: 'Eswatini', aliases: ['Swaziland'] },
  { code: 'TD', name: 'Tsjaad', aliases: ['Chad', 'Tchad'] },
  { code: 'TG', name: 'Togo' },
  { code: 'TN', name: 'Tunesië', aliases: ['Tunisia', 'Tunisie'] },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'UG', name: 'Oeganda', aliases: ['Uganda'] },
  { code: 'YT', name: 'Mayotte' },
  { code: 'ZA', name: 'Zuid-Afrika', aliases: ['South Africa'] },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ZW', name: 'Zimbabwe' },
  // North and Central America, the Caribbean
  { code: 'AG', name: 'Antigua en Barbuda' },
  { code: 'AI', name: 'Anguilla' },
  { code: 'AW', name: 'Aruba' },
  { code: 'BB', name: 'Barbados' },
  { code: 'BL', name: 'Saint-Barthélemy' },
  { code: 'BM', name: 'Bermuda' },
  { code: 'BQ', name: 'Caribisch Nederland', aliases: ['Bonaire', 'Sint Eustatius', 'Saba', 'BES-eilanden'] },
  { code: 'BS', name: "Bahama's", aliases: ['Bahamas'] },
  { code: 'BZ', name: 'Belize' },
  { code: 'CA', name: 'Canada' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'CU', name: 'Cuba' },
  { code: 'CW', name: 'Curaçao' },
  { code: 'DM', name: 'Dominica' },
  { code: 'DO', name: 'Dominicaanse Republiek', aliases: ['Dominican Republic'] },
  { code: 'GD', name: 'Grenada' },
  { code: 'GL', name: 'Groenland', aliases: ['Greenland'] },
  { code: 'GP', name: 'Guadeloupe' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'HN', name: 'Honduras' },
  { code: 'HT', name: 'Haïti', aliases: ['Haiti'] },
  { code: 'JM', name: 'Jamaica' },
  { code: 'KN', name: 'Saint Kitts en Nevis' },
  { code: 'KY', name: 'Kaaimaneilanden', aliases: ['Cayman Islands'] },
  { code: 'LC', name: 'Saint Lucia' },
  { code: 'MF', name: 'Saint-Martin', aliases: ['Sint-Maarten (Frans deel)'] },
  { code: 'MQ', name: 'Martinique' },
  { code: 'MS', name: 'Montserrat' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'PA', name: 'Panama' },
  { code: 'PM', name: 'Saint-Pierre en Miquelon' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'SX', name: 'Sint Maarten' },
  { code: 'TC', name: 'Turks- en Caicoseilanden', aliases: ['Turks and Caicos'] },
  { code: 'TT', name: 'Trinidad en Tobago' },
  { code: 'US', name: 'Verenigde Staten', aliases: ['USA', 'United States', 'Amerika', 'America', 'VS'] },
  { code: 'VC', name: 'Saint Vincent en de Grenadines' },
  { code: 'VG', name: 'Britse Maagdeneilanden', aliases: ['British Virgin Islands'] },
  { code: 'VI', name: 'Amerikaanse Maagdeneilanden', aliases: ['US Virgin Islands'] },
  // South America
  { code: 'AR', name: 'Argentinië', aliases: ['Argentina'] },
  { code: 'BO', name: 'Bolivia' },
  { code: 'BR', name: 'Brazilië', aliases: ['Brazil', 'Brasil'] },
  { code: 'CL', name: 'Chili', aliases: ['Chile'] },
  { code: 'CO', name: 'Colombia' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'FK', name: 'Falklandeilanden', aliases: ['Falkland Islands', 'Malvinas'] },
  { code: 'GF', name: 'Frans-Guyana', aliases: ['French Guiana'] },
  { code: 'GS', name: 'Zuid-Georgia en de Zuidelijke Sandwicheilanden' },
  { code: 'GY', name: 'Guyana' },
  { code: 'PE', name: 'Peru' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'SR', name: 'Suriname' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'VE', name: 'Venezuela' },
  // Oceania
  { code: 'AS', name: 'Amerikaans-Samoa', aliases: ['American Samoa'] },
  { code: 'AU', name: 'Australië', aliases: ['Australia'] },
  { code: 'CC', name: 'Cocoseilanden', aliases: ['Cocos (Keeling) Islands'] },
  { code: 'CK', name: 'Cookeilanden', aliases: ['Cook Islands'] },
  { code: 'CX', name: 'Christmaseiland', aliases: ['Christmas Island'] },
  { code: 'FJ', name: 'Fiji' },
  { code: 'FM', name: 'Micronesia', aliases: ['Micronesië'] },
  { code: 'GU', name: 'Guam' },
  { code: 'HM', name: 'Heard en McDonaldeilanden' },
  { code: 'KI', name: 'Kiribati' },
  { code: 'MH', name: 'Marshalleilanden', aliases: ['Marshall Islands'] },
  { code: 'MP', name: 'Noordelijke Marianen', aliases: ['Northern Mariana Islands'] },
  { code: 'NC', name: 'Nieuw-Caledonië', aliases: ['New Caledonia'] },
  { code: 'NF', name: 'Norfolk', aliases: ['Norfolk Island'] },
  { code: 'NR', name: 'Nauru' },
  { code: 'NU', name: 'Niue' },
  { code: 'NZ', name: 'Nieuw-Zeeland', aliases: ['New Zealand'] },
  { code: 'PF', name: 'Frans-Polynesië', aliases: ['French Polynesia', 'Tahiti'] },
  { code: 'PG', name: 'Papoea-Nieuw-Guinea', aliases: ['Papua New Guinea'] },
  { code: 'PN', name: 'Pitcairneilanden', aliases: ['Pitcairn'] },
  { code: 'PW', name: 'Palau' },
  { code: 'SB', name: 'Salomonseilanden', aliases: ['Solomon Islands'] },
  { code: 'TK', name: 'Tokelau' },
  { code: 'TO', name: 'Tonga' },
  { code: 'TV', name: 'Tuvalu' },
  { code: 'UM', name: 'Kleine afgelegen eilanden van de Verenigde Staten', aliases: ['US Minor Outlying Islands'] },
  { code: 'VU', name: 'Vanuatu' },
  { code: 'WF', name: 'Wallis en Futuna' },
  { code: 'WS', name: 'Samoa' },
  // Antarctic
  { code: 'AQ', name: 'Antarctica' },
  { code: 'BV', name: 'Bouveteiland', aliases: ['Bouvet Island'] },
  { code: 'TF', name: 'Franse Zuidelijke en Antarctische Gebieden', aliases: ['French Southern Territories'] },
];

/** Every country, sorted by Dutch name; the pickers list it, the search ranks it. */
export const ISO_COUNTRIES: IsoCountry[] = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, 'nl'));

/** Codes without a flag glyph: a user-assigned code renders as two boxed letters, which reads as a broken character. */
const NO_FLAG = new Set(['XK']);

/** The flag as two regional-indicator letters; '' for anything that is not a two-letter code or has no flag. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code) || NO_FLAG.has(code.toUpperCase())) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/**
 * Lower case without diacritics, hyphens and spaces alike one space, so "saoedi" finds Saoedi-Arabië, "turkiye"
 * finds Türkiye and "zuid afrika" finds Zuid-Afrika (and "sint-maarten" Sint Maarten).
 */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-\s]+/g, ' ').trim().toLowerCase();
}

/**
 * The countries matching a query on code, name or alias, the best match
 * first: an exact code, name or alias ("uk" is the Verenigd Koninkrijk before
 * Ukraine), then names starting with the query, then a word of the name, an
 * alias or the code starting with it, then anything containing it. Within a
 * rank the given order holds, so a caller's preferred countries stay in
 * front. An empty query returns the list as given.
 */
export function searchCountries(query: string, countries: readonly IsoCountry[] = ISO_COUNTRIES): IsoCountry[] {
  const needle = fold(query.trim());
  if (!needle) return [...countries];
  const rank = (country: IsoCountry): number => {
    const code = country.code.toLowerCase();
    const name = fold(country.name);
    const aliases = (country.aliases ?? []).map(fold);
    if (code === needle || name === needle || aliases.includes(needle)) return 0;
    if (name.startsWith(needle)) return 1;
    if (code.startsWith(needle) || name.split(/\s+/).some((word) => word.startsWith(needle))
        || aliases.some((alias) => alias.startsWith(needle))) return 2;
    if (name.includes(needle) || aliases.some((alias) => alias.includes(needle))) return 3;
    return -1;
  };
  return countries
    .map((country, index) => ({ country, index, rank: rank(country) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.country);
}

/** Dutch name for an ISO code; falls back to the code itself. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  return ISO_COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

export interface PortOption {
  /** Stable value exchanged with the API. */
  value: string;
  /** Friendly name shown in the native mobile picker. */
  label: string;
}

/** Sentinel used by a port picker to reveal its free-text alternative. */
export const OTHER_PORT_VALUE = '__OTHER_PORT__';

/**
 * Main Chinese container ports used for our sourcing lanes.
 *
 * The API deliberately keeps the short city name. The terminal/port-system
 * name in the label helps a buyer pick the right option without changing
 * existing freight routes such as `Ningbo -> Rotterdam`.
 */
export const CHINESE_DEPARTURE_PORTS: readonly PortOption[] = [
  { value: 'Ningbo', label: 'Ningbo — Ningbo-Zhoushan' },
  { value: 'Shanghai', label: 'Shanghai' },
  { value: 'Shenzhen', label: 'Shenzhen — Yantian' },
  { value: 'Guangzhou', label: 'Guangzhou — Nansha' },
  { value: 'Qingdao', label: 'Qingdao' },
  { value: 'Tianjin', label: 'Tianjin — Xingang' },
  { value: 'Xiamen', label: 'Xiamen' },
];

/** Frequent European destination ports; every other port stays possible. */
export const DESTINATION_PORTS: readonly PortOption[] = [
  { value: 'Rotterdam', label: 'Rotterdam' },
  { value: 'Amsterdam', label: 'Amsterdam' },
  { value: 'Antwerpen', label: 'Antwerpen' },
  { value: 'Zeebrugge', label: 'Zeebrugge' },
  { value: 'Hamburg', label: 'Hamburg' },
  { value: 'Bremerhaven', label: 'Bremerhaven' },
  { value: 'Felixstowe', label: 'Felixstowe' },
  { value: 'Le Havre', label: 'Le Havre' },
];

/**
 * Container types as the API names them, with human labels.
 *
 * The select previously used shipping codes ("40HQ") while the API speaks
 * enum names ("FORTY_HQ") - no option ever matched, so the dropdown sat
 * empty. One list, keyed by what the API actually sends.
 */
export const PURCHASE_CONTAINER_TYPES = [
  { value: 'TWENTY_GP', shortLabel: '20 ft', label: "20' Standard — 28 m³",
    capacityCbm: 28, note: 'Compacte zending' },
  { value: 'FORTY_GP', shortLabel: '40 ft', label: "40' Standard — 58 m³",
    capacityCbm: 58, note: 'Standaardhoogte' },
  { value: 'FORTY_HQ', shortLabel: '40 ft HQ', label: "40' High Cube — 68 m³",
    capacityCbm: 68, note: 'Meeste laadruimte' },
] as const;

export type PurchaseContainerType = typeof PURCHASE_CONTAINER_TYPES[number]['value'];
export const DEFAULT_PURCHASE_CONTAINER_TYPE: PurchaseContainerType = 'FORTY_HQ';

export const CONTAINER_TYPES = [
  ...PURCHASE_CONTAINER_TYPES,
  { value: 'LCL', shortLabel: 'LCL', label: 'Groepage (LCL)', capacityCbm: 0,
    note: 'Deelzending' },
] as const;

/** Label for a container enum name; falls back to the raw value. */
export function containerLabel(value: string | null | undefined): string {
  if (!value) return '';
  return CONTAINER_TYPES.find((type) => type.value === value)?.label ?? value;
}

/**
 * Uses the server's CBM result, with a rolling-deploy fallback for responses
 * from the previous backend version that did not expose the count yet.
 */
export function containerCountForFill(fill: {
  capacityCbm: number;
  usedCbm: number;
  minimumContainerCount?: number | null;
}): number {
  const supplied = fill.minimumContainerCount;
  if (typeof supplied === 'number' && Number.isInteger(supplied) && supplied >= 0 &&
      (fill.usedCbm <= 0 || supplied > 0)) {
    return supplied;
  }
  if (!Number.isFinite(fill.capacityCbm) || fill.capacityCbm <= 0 ||
      !Number.isFinite(fill.usedCbm) || fill.usedCbm <= 0) return 0;
  return Math.ceil(fill.usedCbm / fill.capacityCbm);
}

/**
 * Standard product colours, stored in Dutch.
 *
 * These names translate automatically on quotes and catalogues through the
 * backend dictionary. A colour typed outside this list stays possible, but
 * then translation runs through the catalogue workbook like any other product text.
 */
export const STANDARD_COLOURS = [
  'Rood', 'Roze', 'Fuchsia', 'Bordeaux', 'Wit', 'Ivoor', 'Champagne',
  'Geel', 'Oranje', 'Groen', 'Blauw', 'Paars', 'Lila',
  'Zwart', 'Grijs', 'Zilver', 'Goud', 'Gemengd',
] as const;

/**
 * Default swatch per standard colour - mirrors the backend's
 * ColourSwatches so the sample shows the moment a colour is picked. The
 * backend fills the same default on every write; this is feedback, not
 * the source of truth.
 */
export const COLOUR_SWATCHES: Record<string, string> = {
  Rood: '#A91F32', Roze: '#E59BB4', Fuchsia: '#C2187A', Bordeaux: '#6B1A2B',
  Wit: '#F4F1EC', Ivoor: '#F1E9D6', Champagne: '#E8D6B3', Geel: '#F2C94C',
  Oranje: '#EF8A2F', Groen: '#3E7D4F', Blauw: '#2F5D9E', Paars: '#6E3C9A',
  Lila: '#B69AD6', Zwart: '#1A1614', Grijs: '#9A9A9A', Zilver: '#C0C4C9',
  Goud: '#C9A227', Gemengd: '#D8C3C3',
};

/**
 * Standard payment terms, stored in Dutch.
 *
 * These translate automatically on quotes through the backend dictionary;
 * a term typed outside this list stays possible and passes through as-is.
 */
export const STANDARD_PAYMENT_TERMS = [
  'Vooruitbetaling',
  '30% voorschot / 70% bij levering',
  '50% voorschot / 50% bij levering',
  '30% voorschot / 40% voor verzending / 30% bij levering',
  'Bij levering',
  '14 dagen netto',
  '30 dagen netto',
  '60 dagen netto',
] as const;
