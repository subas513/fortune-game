// Live presence registry, written by the game manager and read by the REST API.
// playerId -> { roomId, since, ip }
export const presence = new Map();
