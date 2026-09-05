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
}

export interface CommanderBracketEstimate {
  validation?: {
    valid?: boolean;
    errors?: CommanderBracketValidationIssue[];
    warnings?: CommanderBracketValidationIssue[];
    card_count?: number;
  };
  bracket_analysis?: CommanderBracketAnalysis;
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

export function getDisplayBracket(analysis: CommanderBracketAnalysis | undefined) {
  if (!analysis) return undefined;
  return analysis.final_bracket ?? analysis.deck_bracket;
}

export function getBracketTagLabel(bracket: number | undefined) {
  if (bracket == null) return undefined;
  if (bracket === 5) return 'cEDH';
  return `Bracket ${bracket}`;
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
