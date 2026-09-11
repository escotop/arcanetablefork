/** Screen-space ping wheel geometry (donut ring). */
export const PING_WHEEL_OUTER_RADIUS = 96;
export const PING_WHEEL_INNER_RADIUS = 42;
export const PING_WHEEL_SIZE = PING_WHEEL_OUTER_RADIUS * 2 + 8;

function polarToCartesian(cx: number, cy: number, radius: number, angleRad: number) {
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

export function describeDonutSegment(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
) {
  const startOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const endOuter = polarToCartesian(cx, cy, outerR, endAngle);
  const startInner = polarToCartesian(cx, cy, innerR, endAngle);
  const endInner = polarToCartesian(cx, cy, innerR, startAngle);
  const largeArc = endAngle - startAngle <= Math.PI ? 0 : 1;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

export function getSegmentAngles(index: number, count: number) {
  const slice = (Math.PI * 2) / count;
  // Center segment midpoints on cardinals (top/right/bottom/left), not diagonals.
  const start = index * slice - Math.PI / 2 - slice / 2;
  return { start, end: start + slice, mid: start + slice / 2 };
}

export function getLabelPosition(cx: number, cy: number, index: number, count: number) {
  const { mid } = getSegmentAngles(index, count);
  const radius = (PING_WHEEL_INNER_RADIUS + PING_WHEEL_OUTER_RADIUS) / 2;
  return polarToCartesian(cx, cy, radius, mid);
}

/**
 * Which ping sector contains the cursor — infinite-radius wedge from wheel center.
 * Segment 0 is centered at the top, then clockwise (right, bottom, left).
 */
export function getPingWheelSectorIndex(
  centerX: number,
  centerY: number,
  mouseX: number,
  mouseY: number,
  count: number,
) {
  const dx = mouseX - centerX;
  const dy = mouseY - centerY;
  if (Math.hypot(dx, dy) < 1) return 0;

  const angle = Math.atan2(dy, dx);
  const slice = (Math.PI * 2) / count;
  const shifted = angle + Math.PI / 2;
  const normalized = ((shifted + slice / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return Math.min(count - 1, Math.floor(normalized / slice));
}

/** @deprecated Use getPingWheelSectorIndex */
export const getNearestPingWheelIndex = getPingWheelSectorIndex;

/** @deprecated Use getPingWheelSectorIndex */
export const getPingWheelHoverIndex = getPingWheelSectorIndex;
