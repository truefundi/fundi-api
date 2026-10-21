// Limits for a job's single price-negotiation conversation. A conversation is
// only for agreeing a price; it closes once the two sides agree, decline, or the
// active offer lapses. Keep these values here so the DTOs and the service agree.
export const CONVERSATION_MAX_OFFERS_PER_SIDE = 3;
export const CONVERSATION_MAX_TOTAL_OFFERS = 6;
export const CONVERSATION_OFFER_TTL_SECONDS = 24 * 60 * 60;
export const CONVERSATION_MAX_MESSAGE_LENGTH = 500;
export const CONVERSATION_MIN_AMOUNT = 1;
export const CONVERSATION_MAX_AMOUNT = 2_000_000_000;
