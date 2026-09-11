import styles from './pingWheel.module.css';
import { For, Show } from 'solid-js';
import {
  pingWheelCenter,
  pingWheelHoverIndex,
  pingWheelOpen,
} from '../pingWheelState';
import { PING_WHEEL_TYPES } from '../pingTypes';
import {
  describeDonutSegment,
  getLabelPosition,
  getSegmentAngles,
  PING_WHEEL_INNER_RADIUS,
  PING_WHEEL_OUTER_RADIUS,
  PING_WHEEL_SIZE,
} from '../pingWheelGeometry';

const SVG_CENTER = PING_WHEEL_SIZE / 2;

export default function PingWheel() {
  return (
    <Show when={pingWheelOpen()}>
      <div class={styles.root}>
        <div
          class={styles.wheel}
          style={{
            left: `${pingWheelCenter().x}px`,
            top: `${pingWheelCenter().y}px`,
            width: `${PING_WHEEL_SIZE}px`,
            height: `${PING_WHEEL_SIZE}px`,
          }}
        >
          <svg
            class={styles.svg}
            viewBox={`0 0 ${PING_WHEEL_SIZE} ${PING_WHEEL_SIZE}`}
            aria-hidden='true'
          >
            <For each={PING_WHEEL_TYPES}>
              {(type, index) => {
                const hovered = () => pingWheelHoverIndex() === index();
                const angles = () => getSegmentAngles(index(), PING_WHEEL_TYPES.length);
                const label = () =>
                  getLabelPosition(SVG_CENTER, SVG_CENTER, index(), PING_WHEEL_TYPES.length);

                return (
                  <g>
                    <path
                      d={describeDonutSegment(
                        SVG_CENTER,
                        SVG_CENTER,
                        PING_WHEEL_INNER_RADIUS,
                        PING_WHEEL_OUTER_RADIUS,
                        angles().start,
                        angles().end,
                      )}
                      class={styles.segment}
                      classList={{ [styles.segmentHovered]: hovered() }}
                      style={{ '--segment-accent': type.accent }}
                    />
                    <text
                      x={label().x}
                      y={label().y}
                      class={styles.segmentLabel}
                      classList={{ [styles.segmentLabelHovered]: hovered() }}
                      text-anchor='middle'
                      dominant-baseline='middle'
                    >
                      {type.label}
                    </text>
                  </g>
                );
              }}
            </For>
            <circle
              cx={SVG_CENTER}
              cy={SVG_CENTER}
              r={PING_WHEEL_INNER_RADIUS - 2}
              class={styles.innerHole}
            />
          </svg>
        </div>
      </div>
    </Show>
  );
}
