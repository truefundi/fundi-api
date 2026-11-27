import { ConversationSender } from '@prisma/client';

// Pure negotiation rules, kept out of the service so they can be unit tested.

/** An offer lapses once its expiry has passed; a null expiry never lapses. */
export function isOfferExpired(expiresAt: Date | null, now = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/**
 * A party may only accept, decline, or counter an offer made by the other side.
 * System entries and same-side responses are not valid.
 */
export function canRespondToOffer(
  offerSender: ConversationSender,
  responder: ConversationSender,
): boolean {
  if (offerSender === ConversationSender.SYSTEM) return false;
  if (responder === ConversationSender.SYSTEM) return false;
  return offerSender !== responder;
}

/** The role a participant acts as inside the conversation. */
export function participantRole(isCustomer: boolean): ConversationSender {
  return isCustomer ? ConversationSender.CUSTOMER : ConversationSender.TECHNICIAN;
}
