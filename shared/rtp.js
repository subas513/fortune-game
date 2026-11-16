// Certified-style RTP levels: each game ships fixed math for these levels only.
// Fish tables use the level directly (capture chance = rtp / multiplier); each slot
// machine has its own reel strips per level (see shared/slots.js).
export const RTP_LEVELS = [0.92, 0.94, 0.96];
export const DEFAULT_RTP = 0.96;
export const rtpKey = (rtp) => String(Math.round(rtp * 100));
export const isRtpLevel = (v) => RTP_LEVELS.some((l) => Math.abs(l - v) < 1e-9);
