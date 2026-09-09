import { gzipSync } from 'fflate';
import { DetailedCardEntry } from './constants';
import { getCommanderNames, isCommanderCard } from './deckCommander';

const COMMANDER_BRACKET_API = '/api/commander-bracket';
export const COMMANDER_BRACKET_SITE = 'https://commanderbracket.app';

export const BRACKET_COLORS: Record<number, string> = {
  1: '#22c55e',
  2: '#3b82f6',
  3: '#a855f7',
  4: '#f97316',
  5: '#ef4444',
};

export interface CommanderBracketValidationIssue {
  message: string;
  code?: string;
  severity?: string;
}

export interface CommanderBracketExplanationV2 {
  how_it_plays?: string;
  bracket_narrative?: string;
}

export interface CommanderBracketHoldPriorityCard {
  name: string;
  reason_code?: string;
  timing_code?: string;
  reason?: string;
  timing?: string;
}

export interface CommanderBracketMulliganAdvice {
  land_range?: { min?: number; max?: number };
  p_keepable?: number;
  accelerant_examples?: string[];
  commander_castable_by?: number;
}

export interface CommanderBracketPlayAdvice {
  mulligan?: CommanderBracketMulliganAdvice;
  hold_priority?: CommanderBracketHoldPriorityCard[];
}

export interface CommanderBracketDeckStatsReport {
  consistency?: {
    p_keepable_opener?: number;
    expected_opening_lands?: number;
  };
  advice?: CommanderBracketPlayAdvice;
}

export interface CommanderBracketDeckStats {
  report?: CommanderBracketDeckStatsReport;
}

export interface CommanderBracketWorthHoldingCard {
  name: string;
  reasonLabel: string;
  timingLabel: string;
}

export interface CommanderBracketHowItPlaysSection {
  summary: string;
  bullets: string[];
  landRange?: { min: number; max: number };
  openerDetail?: string;
  worthHolding: CommanderBracketWorthHoldingCard[];
}

export interface CommanderBracketAnalysis {
  deck_bracket?: number;
  speed_bracket?: number;
  warp_bracket?: number;
  final_bracket?: number;
  bracket_description?: string;
  bracket_reason?: string;
  estimated_win_turn?: number;
  bracket_determined_by?: string;
  total_game_changers?: number;
  game_changers_found?: string[];
  requires_disclosure?: boolean;
  how_it_plays?: string;
  bracket_narrative?: string;
  explanation_v2?: CommanderBracketExplanationV2;
}

export interface CommanderBracketEstimate {
  validation?: {
    valid?: boolean;
    errors?: CommanderBracketValidationIssue[];
    warnings?: CommanderBracketValidationIssue[];
    card_count?: number;
  };
  bracket_analysis?: CommanderBracketAnalysis;
  deck_stats?: CommanderBracketDeckStats;
  strengths?: string[];
  weaknesses?: string[];
  deck_health?: { score?: number };
  commander_analysis?: { name?: string; color_identity?: string[] };
  share_link?: string;
}

export class CommanderBracketApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'CommanderBracketApiError';
  }
}

const HOLD_REASON_LABELS: Record<string, string> = {
  instant_interaction: 'Instant speed',
};

const HOLD_TIMING_LABELS: Record<string, string> = {
  open_mana: 'generally worth leaving mana open for',
  before_committing_board: 'generally worth holding before committing your board to a big turn',
};

export function getDisplayBracket(analysis: CommanderBracketAnalysis | undefined) {
  if (!analysis) return undefined;
  return analysis.final_bracket ?? analysis.deck_bracket;
}

function formatKeepablePercent(value: number | undefined) {
  if (value == null) return undefined;
  return `${Math.round(value * 100)}%`;
}

function getHoldReasonLabel(card: CommanderBracketHoldPriorityCard) {
  return card.reason?.trim() || HOLD_REASON_LABELS[card.reason_code ?? ''] || card.reason_code || '';
}

function getHoldTimingLabel(card: CommanderBracketHoldPriorityCard) {
  return card.timing?.trim() || HOLD_TIMING_LABELS[card.timing_code ?? ''] || card.timing_code || '';
}

export function getHowItPlaysSection(
  result: CommanderBracketEstimate | undefined,
): CommanderBracketHowItPlaysSection | undefined {
  const advice = result?.deck_stats?.report?.advice;
  const consistency = result?.deck_stats?.report?.consistency;
  if (!advice?.mulligan && !advice?.hold_priority?.length) return undefined;

  const mulligan = advice.mulligan;
  const pKeepable = mulligan?.p_keepable ?? consistency?.p_keepable_opener;
  const holdPriority = advice.hold_priority ?? [];
  const landMin = mulligan?.land_range?.min;
  const landMax = mulligan?.land_range?.max;

  const summaryParts: string[] = [];
  const keepableLabel = formatKeepablePercent(pKeepable);
  if (keepableLabel) summaryParts.push(`${keepableLabel} keepable openers`);
  if (holdPriority.length) {
    summaryParts.push(
      `${holdPriority.length} card${holdPriority.length === 1 ? '' : 's'} worth holding`,
    );
  }

  const bullets: string[] = [];
  if (landMin != null && landMax != null) {
    bullets.push(`Keep ${landMin}-${landMax} lands`);
  }
  if (mulligan?.commander_castable_by != null) {
    bullets.push(`Commander online by turn ${mulligan.commander_castable_by}`);
  }

  let openerDetail: string | undefined;
  if (keepableLabel && landMin != null && landMax != null) {
    openerDetail = `${keepableLabel} of openers are keepable (${landMin}-${landMax} lands and a castable early play, across your first two draws)`;
  }

  const worthHolding = holdPriority
    .map(card => ({
      name: card.name,
      reasonLabel: getHoldReasonLabel(card),
      timingLabel: getHoldTimingLabel(card),
    }))
    .filter(card => card.name);

  if (!summaryParts.length && !bullets.length && !openerDetail && !worthHolding.length) {
    return undefined;
  }

  return {
    summary: summaryParts.join(', '),
    bullets,
    landRange:
      landMin != null && landMax != null ? { min: landMin, max: landMax } : undefined,
    openerDetail,
    worthHolding,
  };
}

export function getDeckEntriesForBracketEstimate(deck: { cards?: Record<string, DetailedCardEntry> }) {
  return Object.values(deck.cards ?? {}).filter(card => card.qty > 0);
}

export async function resolveHowItPlaysAdviceForDeck(deck?: {
  cards?: Record<string, DetailedCardEntry>;
  howItPlaysAdvice?: CommanderBracketHowItPlaysSection;
}) {
  if (!deck) return undefined;

  const cards = getDeckEntriesForBracketEstimate(deck);
  if (!getCommanderNames(cards).length) return deck.howItPlaysAdvice;

  try {
    const result = await estimateCommanderBracket(cards);
    return getHowItPlaysSection(result) ?? deck.howItPlaysAdvice;
  } catch {
    return deck.howItPlaysAdvice;
  }
}

export function getBracketTagLabel(bracket: number | undefined) {
  if (bracket == null) return undefined;
  if (bracket === 5) return 'cEDH';
  return `Bracket ${bracket}`;
}

export function compareDecksByBracket(
  left: { bracketEstimate?: number; name: string },
  right: { bracketEstimate?: number; name: string },
) {
  const leftBracket = left.bracketEstimate;
  const rightBracket = right.bracketEstimate;

  if (leftBracket == null && rightBracket == null) return left.name.localeCompare(right.name);
  if (leftBracket == null) return 1;
  if (rightBracket == null) return -1;
  if (leftBracket !== rightBracket) return leftBracket - rightBracket;
  return left.name.localeCompare(right.name);
}

export function isSuccessfulBracketEstimate(result: CommanderBracketEstimate) {
  if ((result.validation?.errors?.length ?? 0) > 0) return false;
  const bracket = getDisplayBracket(result.bracket_analysis);
  return bracket != null && bracket >= 1 && bracket <= 5;
}

export function getBracketEstimateFromResult(result: CommanderBracketEstimate) {
  if (!isSuccessfulBracketEstimate(result)) return undefined;
  return getDisplayBracket(result.bracket_analysis);
}

export function getBracketColor(bracket: number | undefined) {
  if (bracket == null || bracket < 1 || bracket > 5) return undefined;
  return BRACKET_COLORS[bracket];
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function encodeCommanderBracketDeckParam(data: {
  decklist: string;
  commander?: string;
  partner?: string;
}) {
  if (!data.decklist.trim()) return null;

  const payload: Record<string, string> = { decklist: data.decklist };
  if (data.commander) payload.commander = data.commander;
  if (data.partner) payload.partner = data.partner;

  try {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.length > 65536) return null;

    const compressed = gzipSync(bytes, { level: 9 });
    const encoded = base64UrlEncode(compressed);
    if (encoded.length > 16384) return null;
    return encoded;
  } catch {
    return null;
  }
}

export function buildCommanderBracketShareUrl(
  payload: ReturnType<typeof buildCommanderBracketPayload>,
) {
  const encoded = encodeCommanderBracketDeckParam({
    decklist: payload.decklist,
    commander: payload.commander,
    partner: payload.commanders[1],
  });

  if (!encoded) return `${COMMANDER_BRACKET_SITE}/bracket`;

  const params = new URLSearchParams({
    deck: encoded,
    src: 'partner_deep_link',
  });
  return `${COMMANDER_BRACKET_SITE}/bracket?${params.toString()}`;
}

export function formatCommanderBracketDeckListLine(card: DetailedCardEntry) {
  return `${card.qty} ${card.name}`;
}

export function buildCommanderBracketPayload(cards: DetailedCardEntry[]) {
  const active = cards.filter(card => card.qty > 0);
  const commanders = getCommanderNames(active);
  const main = active.filter(card => !isCommanderCard(card));

  const lines: string[] = [];
  if (commanders.length) {
    lines.push('// Commander');
    for (const name of commanders) {
      lines.push(`1 ${name}`);
    }
    lines.push('');
  }

  for (const card of main) {
    lines.push(formatCommanderBracketDeckListLine(card));
  }

  return {
    decklist: lines.join('\n'),
    commander: commanders[0],
    commanders,
  };
}

export async function estimateCommanderBracket(
  cards: DetailedCardEntry[],
): Promise<CommanderBracketEstimate> {
  const payload = buildCommanderBracketPayload(cards);

  if (!payload.commanders.length) {
    throw new CommanderBracketApiError('Mark at least one card as commander before estimating.');
  }

  const response = await fetch(COMMANDER_BRACKET_API, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decklist: payload.decklist,
      commander: payload.commander,
    }),
  });

  const body = await response.text();
  let parsed: CommanderBracketEstimate & { detail?: string; error?: string };

  try {
    parsed = JSON.parse(body) as CommanderBracketEstimate & { detail?: string; error?: string };
  } catch {
    throw new CommanderBracketApiError(
      'Unexpected response from CommanderBracket.',
      response.status,
      body.slice(0, 200),
    );
  }

  if (!response.ok) {
    throw new CommanderBracketApiError(
      parsed.detail ?? parsed.error ?? 'CommanderBracket request failed.',
      response.status,
      typeof parsed.detail === 'string' ? parsed.detail : body.slice(0, 200),
    );
  }

  return parsed;
}
