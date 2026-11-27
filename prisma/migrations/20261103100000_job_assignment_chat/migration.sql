CREATE TYPE "ChatRoomStatus" AS ENUM ('ACTIVE', 'DISABLED', 'COMPLETED');
CREATE TYPE "ChatSenderRole" AS ENUM ('CUSTOMER', 'TECHNICIAN', 'ADMIN', 'SYSTEM');
CREATE TYPE "ChatMessageType" AS ENUM ('TEXT', 'VOICE_NOTE', 'FILE', 'IMAGE', 'VIDEO', 'SYSTEM');

CREATE TABLE "chat_rooms" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "assignmentHistoryId" TEXT NOT NULL,
    "status" "ChatRoomStatus" NOT NULL DEFAULT 'ACTIVE',
    "disabledAt" TIMESTAMP(3),
    "disabledById" TEXT,
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_room_members" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "blockedAt" TIMESTAMP(3),
    "blockReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_room_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT,
    "senderRole" "ChatSenderRole" NOT NULL,
    "type" "ChatMessageType" NOT NULL,
    "text" TEXT,
    "objectKey" TEXT,
    "mimeType" TEXT,
    "originalFileName" TEXT,
    "sizeBytes" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "isTombstone" BOOLEAN NOT NULL DEFAULT false,
    "blockedAt" TIMESTAMP(3),
    "blockedById" TEXT,
    "blockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_message_reads" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_message_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_rooms_assignmentHistoryId_key" ON "chat_rooms"("assignmentHistoryId");
CREATE INDEX "chat_rooms_jobId_createdAt_idx" ON "chat_rooms"("jobId", "createdAt");
CREATE INDEX "chat_rooms_status_updatedAt_idx" ON "chat_rooms"("status", "updatedAt");

CREATE UNIQUE INDEX "chat_room_members_roomId_userId_key" ON "chat_room_members"("roomId", "userId");
CREATE INDEX "chat_room_members_userId_archivedAt_createdAt_idx" ON "chat_room_members"("userId", "archivedAt", "createdAt");

CREATE UNIQUE INDEX "chat_messages_objectKey_key" ON "chat_messages"("objectKey");
CREATE INDEX "chat_messages_roomId_createdAt_id_idx" ON "chat_messages"("roomId", "createdAt", "id");
CREATE INDEX "chat_messages_senderId_createdAt_idx" ON "chat_messages"("senderId", "createdAt");

CREATE UNIQUE INDEX "chat_message_reads_messageId_userId_key" ON "chat_message_reads"("messageId", "userId");
CREATE INDEX "chat_message_reads_userId_readAt_idx" ON "chat_message_reads"("userId", "readAt");

ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_assignmentHistoryId_fkey"
    FOREIGN KEY ("assignmentHistoryId") REFERENCES "job_assignment_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_message_reads" ADD CONSTRAINT "chat_message_reads_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_message_reads" ADD CONSTRAINT "chat_message_reads_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "chat_rooms" (
    "id", "jobId", "assignmentHistoryId", "status", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    j."id",
    history."id",
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "jobs" j
JOIN LATERAL (
    SELECT history."id"
    FROM "job_assignment_history" history
    WHERE history."jobId" = j."id"
      AND history."technicianId" = j."technicianId"
      AND history."endedAt" IS NULL
    ORDER BY history."acceptedAt" DESC, history."id" DESC
    LIMIT 1
) history ON true
WHERE j."status" IN ('ASSIGNED', 'PAUSED')
  AND j."technicianId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "chat_rooms" room
      WHERE room."assignmentHistoryId" = history."id"
  );

INSERT INTO "chat_room_members" (
    "id", "roomId", "userId", "role", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    room."id",
    job."customerId",
    'CUSTOMER',
    CURRENT_TIMESTAMP
FROM "chat_rooms" room
JOIN "jobs" job ON job."id" = room."jobId"
WHERE NOT EXISTS (
    SELECT 1 FROM "chat_room_members" member
    WHERE member."roomId" = room."id" AND member."userId" = job."customerId"
);

INSERT INTO "chat_room_members" (
    "id", "roomId", "userId", "role", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    room."id",
    technician."userId",
    'TECHNICIAN',
    CURRENT_TIMESTAMP
FROM "chat_rooms" room
JOIN "job_assignment_history" history
  ON history."id" = room."assignmentHistoryId"
JOIN "technician_profiles" technician
  ON technician."id" = history."technicianId"
WHERE NOT EXISTS (
    SELECT 1 FROM "chat_room_members" member
    WHERE member."roomId" = room."id" AND member."userId" = technician."userId"
);
