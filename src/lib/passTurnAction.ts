import { debounce } from 'lodash-es';
import { createPassTurnEvent } from './createEvents';
import { dispatchGameEvent } from './globals';
import { computeNextTurnState } from './turnOrder';

export const dispatchPassTurn = debounce(
  () => {
    dispatchGameEvent(createPassTurnEvent(computeNextTurnState()));
  },
  250,
  { leading: true, trailing: false },
);
