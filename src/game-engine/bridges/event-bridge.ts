/**
 * Event Bridge: Convert old events to new GameEngine events
 * 
 * This allows the old event system to coexist with the new game engine
 * during the migration period.
 */

import { nanoid } from 'nanoid';
import { GameEvent, EventId, PlayerId, CardId } from '../types';
import type { Event } from '../../remoteEvents';

/**
 * Convert old event format to new GameEvent
 */
export function bridgeOldEventToNew(
  oldEvent: Event,
  sequence: number,
): GameEvent | null {
  const baseEvent = {
    eventId: EventId(oldEvent.eventId || nanoid()),
    sequence,
    timestamp: Date.now(),
    playerId: PlayerId(String(oldEvent.clientID)),
  };

  try {
    switch (oldEvent.type) {
      case 'tap': {
        const payload = oldEvent.payload;
        if (!payload?.userData?.id) return null;
        
        return {
          ...baseEvent,
          type: 'CARD_TAPPED',
          payload: {
            cardId: CardId(payload.userData.id),
            tapped: payload.userData.isTapped ?? false,
          },
        };
      }

      case 'flip': {
        const payload = oldEvent.payload;
        if (!payload?.userData?.id) return null;
        
        return {
          ...baseEvent,
          type: 'CARD_FLIPPED',
          payload: {
            cardId: CardId(payload.userData.id),
            flipped: payload.userData.isFlipped ?? false,
          },
        };
      }

      case 'join': {
        const payload = oldEvent.payload;
        return {
          ...baseEvent,
          type: 'PLAYER_JOINED',
          payload: {
            playerId: PlayerId(String(oldEvent.clientID)),
            name: payload?.name || 'Unknown',
            life: payload?.life || 20,
            commanderLife: payload?.commanderLife || 40,
            color: payload?.color || '#888888',
          },
        };
      }

      // TODO: Add more event types as we migrate subsystems
      // case 'modifyCard': for counters
      // case 'transferCard': for movement
      // case 'shuffle': for shuffles

      default:
        // Not all events need to be bridged yet
        return null;
    }
  } catch (error) {
    console.error('[EventBridge] Error converting event:', oldEvent.type, error);
    return null;
  }
}

/**
 * Check if an event type should be bridged
 */
export function shouldBridgeEvent(eventType: string): boolean {
  return ['tap', 'flip', 'join'].includes(eventType);
}
