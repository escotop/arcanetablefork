export const PING_TYPES = [
  { id: 'regular', label: 'Regular', videoSrc: '/pings/Ping - Regular-.mp4', accent: '#60a5fa' },
  { id: 'ask', label: 'Ask', videoSrc: '/pings/Ping - Ask.mp4', accent: '#fbbf24' },
  { id: 'help', label: 'Help', videoSrc: '/pings/Ping - Help.mp4', accent: '#34d399' },
  { id: 'danger', label: 'Danger', videoSrc: '/pings/Ping - Danger-.mp4', accent: '#f87171' },
  { id: 'vision', label: 'Vision', videoSrc: '/pings/Ping - Vision.mp4', accent: '#a78bfa' },
] as const;

/** Wheel layout: top danger, right vision, bottom help, left ask. Regular is G-tap only. */
export const PING_WHEEL_TYPES = [
  PING_TYPES[3], // danger — top
  PING_TYPES[4], // vision — right
  PING_TYPES[2], // help — bottom
  PING_TYPES[1], // ask — left
] as const;

export type PingTypeId = (typeof PING_TYPES)[number]['id'];
export type PingWheelTypeId = (typeof PING_WHEEL_TYPES)[number]['id'];

export function getPingType(id: PingTypeId | undefined) {
  if (!id) return PING_TYPES[0];
  return PING_TYPES.find(type => type.id === id) ?? PING_TYPES[0];
}

export {
  getPingWheelSectorIndex,
  getNearestPingWheelIndex,
  getPingWheelHoverIndex,
} from './pingWheelGeometry';
