import type { PingTypeId } from './pingTypes';

export interface PingTuneSettings {
  size: number;
  xOffset: number;
  yOffset: number;
  volume: number;
}

/** Shared render tuning for local and remote pings (all clients). */
export const DEFAULT_PING_TUNE: Record<PingTypeId, PingTuneSettings> = {
  regular: { size: 220, xOffset: -7, yOffset: 9, volume: 1 },
  ask: { size: 147, xOffset: 0, yOffset: 0, volume: 0.23 },
  help: { size: 220, xOffset: 0, yOffset: -9, volume: 1 },
  danger: { size: 100, xOffset: 0, yOffset: 0, volume: 0.15 },
  vision: { size: 220, xOffset: 0, yOffset: -23, volume: 1 },
};

export function getPingTune(pingType: PingTypeId): PingTuneSettings {
  return DEFAULT_PING_TUNE[pingType] ?? DEFAULT_PING_TUNE.regular;
}
