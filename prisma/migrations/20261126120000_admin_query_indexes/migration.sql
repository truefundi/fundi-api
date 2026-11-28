-- List ordering and dashboard range scans. No changes to existing data.
CREATE INDEX "jobs_createdAt_id_idx" ON "jobs" ("createdAt" DESC, "id");
CREATE INDEX "jobs_status_createdAt_id_idx" ON "jobs" ("status", "createdAt" DESC, "id");
CREATE INDEX "jobs_completedAt_idx" ON "jobs" ("completedAt");
CREATE INDEX "booking_payments_paidAt_id_idx" ON "booking_payments" ("paidAt" DESC, "id");
CREATE INDEX "audit_logs_createdAt_id_idx" ON "audit_logs" ("createdAt", "id");
