/**
 * Where a sale comes from. The codes are stored on the document; the
 * labels are ours. A channel that is not in this list is still valid: it
 * shows under its own code until it gets a label here.
 */
export interface SalesChannel {
  code: string;
  label: string;
  /** One line on what belongs here, for the pickers. */
  hint: string;
}

export const DIRECT_CHANNEL = 'DIRECT';

export const SALES_CHANNELS: readonly SalesChannel[] = [
  { code: 'DIRECT', label: 'Rechtstreeks', hint: 'Offertes en facturen aan onze eigen klanten' },
  { code: 'WEBSITE', label: 'Website', hint: 'Aanvragen die via enrosed.com binnenkomen' },
  { code: 'TICA', label: 'TICA', hint: 'Verkoop vanaf de stand bij TICA, vanaf oktober' },
  { code: 'PARTNER', label: 'Partner & veiling', hint: 'Containers met een partner en de veilingafrekening' },
  { code: 'FAIR', label: 'Beurs', hint: 'Verkoop en orders op een beurs' },
];

export function channelLabel(code: string | null | undefined): string {
  const normalised = (code ?? '').trim().toUpperCase() || DIRECT_CHANNEL;
  return SALES_CHANNELS.find((channel) => channel.code === normalised)?.label ?? titleCase(normalised);
}

export function channelCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase() || DIRECT_CHANNEL;
}

/** Every channel in use plus the known ones, so a picker never hides a stored value. */
export function channelChoices(inUse: readonly (string | null | undefined)[]): SalesChannel[] {
  const known = [...SALES_CHANNELS];
  for (const raw of inUse) {
    const code = channelCode(raw);
    if (!known.some((channel) => channel.code === code)) known.push({ code, label: titleCase(code), hint: 'Eigen kanaal' });
  }
  return known;
}

function titleCase(code: string): string {
  return code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');
}
