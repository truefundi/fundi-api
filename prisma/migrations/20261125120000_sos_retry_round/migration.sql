-- SOS: a customer retry starts a new round of offers.
ALTER TABLE "jobs" ADD COLUMN "sosRoundStartedAt" TIMESTAMP(3);
