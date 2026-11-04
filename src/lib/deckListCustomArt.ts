const CUSTOM_ART_LINE_SUFFIX = /\{art:([^}]*)\}\s*$/;

export function formatDeckListCustomArtSuffix(customArtUrl: string) {
  return ` {art:${encodeURIComponent(customArtUrl.trim())}}`;
}

export function stripDeckListCustomArt(rawLine: string): { line: string; customArtUrl?: string } {
  const match = rawLine.match(CUSTOM_ART_LINE_SUFFIX);
  if (!match) return { line: rawLine };

  const encoded = match[1] ?? '';
  let customArtUrl = encoded;
  try {
    customArtUrl = decodeURIComponent(encoded);
  } catch {
    customArtUrl = encoded;
  }

  return {
    line: rawLine.slice(0, match.index).trimEnd(),
    customArtUrl: customArtUrl || undefined,
  };
}
