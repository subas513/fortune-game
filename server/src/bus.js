import { EventEmitter } from 'node:events';

// In-process event bus connecting the REST side (agents/admin) with the realtime game side.
// Events:
//   'balance'      (playerId, balance)           player balance changed outside of gameplay
//   'kick'         (playerId, reason)            force-disconnect a player
//   'rooms'        ()                            room configuration changed
export const bus = new EventEmitter();
bus.setMaxListeners(50);
