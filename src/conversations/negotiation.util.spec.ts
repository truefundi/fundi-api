import { ConversationSender } from '@prisma/client';
import {
  canRespondToOffer,
  isOfferExpired,
  participantRole,
} from './negotiation.util';

describe('negotiation.util', () => {
  describe('isOfferExpired', () => {
    const now = new Date('2026-10-16T12:00:00.000Z');

    it('treats a null expiry as never lapsing', () => {
      expect(isOfferExpired(null, now)).toBe(false);
    });

    it('is false before the expiry', () => {
      expect(isOfferExpired(new Date('2026-10-16T12:00:01.000Z'), now)).toBe(
        false,
      );
    });

    it('is true at or after the expiry', () => {
      expect(isOfferExpired(new Date('2026-10-16T12:00:00.000Z'), now)).toBe(
        true,
      );
      expect(isOfferExpired(new Date('2026-10-16T11:59:59.000Z'), now)).toBe(
        true,
      );
    });
  });

  describe('canRespondToOffer', () => {
    it('allows the other party to respond', () => {
      expect(
        canRespondToOffer(
          ConversationSender.TECHNICIAN,
          ConversationSender.CUSTOMER,
        ),
      ).toBe(true);
      expect(
        canRespondToOffer(
          ConversationSender.CUSTOMER,
          ConversationSender.TECHNICIAN,
        ),
      ).toBe(true);
    });

    it('rejects responding to your own offer', () => {
      expect(
        canRespondToOffer(
          ConversationSender.CUSTOMER,
          ConversationSender.CUSTOMER,
        ),
      ).toBe(false);
    });

    it('rejects system senders', () => {
      expect(
        canRespondToOffer(ConversationSender.SYSTEM, ConversationSender.CUSTOMER),
      ).toBe(false);
      expect(
        canRespondToOffer(ConversationSender.CUSTOMER, ConversationSender.SYSTEM),
      ).toBe(false);
    });
  });

  describe('participantRole', () => {
    it('maps the customer flag to a sender role', () => {
      expect(participantRole(true)).toBe(ConversationSender.CUSTOMER);
      expect(participantRole(false)).toBe(ConversationSender.TECHNICIAN);
    });
  });
});
