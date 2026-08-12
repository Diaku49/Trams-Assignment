-- Notification Service owns a separate database and migration history.
CREATE TABLE "notification_deliveries" (
    "eventId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "recipient" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX "notification_deliveries_sentAt_idx"
ON "notification_deliveries"("sentAt");

CREATE INDEX "notification_deliveries_claimedAt_idx"
ON "notification_deliveries"("claimedAt");
