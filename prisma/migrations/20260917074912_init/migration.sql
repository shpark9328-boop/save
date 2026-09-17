-- CreateEnum
CREATE TYPE "TrainType" AS ENUM ('KTX', 'KTX_SANCHEON', 'KTX_EUM', 'KTX_CHEONGRYONG', 'ITX_SAEMAEUL');

-- CreateEnum
CREATE TYPE "SeatClass" AS ENUM ('GENERAL', 'FIRST');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'SOLD_OUT', 'WAITLIST', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WEB_PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('OK', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "watchTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchGroup" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "departureStationCode" TEXT NOT NULL,
    "arrivalStationCode" TEXT NOT NULL,
    "travelDate" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lockedUntil" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "departureStationCode" TEXT NOT NULL,
    "departureStationName" TEXT NOT NULL,
    "arrivalStationCode" TEXT NOT NULL,
    "arrivalStationName" TEXT NOT NULL,
    "travelDate" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "passengerCount" INTEGER NOT NULL DEFAULT 1,
    "trainTypes" "TrainType"[],
    "seatClasses" "SeatClass"[],
    "channels" "NotificationChannel"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxNotifications" INTEGER NOT NULL DEFAULT 20,
    "notificationCount" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSeatState" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "trainNo" TEXT NOT NULL,
    "seatClass" "SeatClass" NOT NULL,
    "satisfied" BOOLEAN NOT NULL DEFAULT false,
    "lastStatus" "SeatStatus" NOT NULL DEFAULT 'UNKNOWN',
    "remainingSeats" INTEGER,
    "notifyCount" INTEGER NOT NULL DEFAULT 0,
    "lastChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "AlertSeatState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainSnapshot" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "trainNo" TEXT NOT NULL,
    "trainType" "TrainType" NOT NULL,
    "trainName" TEXT NOT NULL,
    "departureAt" TIMESTAMP(3) NOT NULL,
    "arrivalAt" TIMESTAMP(3) NOT NULL,
    "seatClass" "SeatClass" NOT NULL,
    "status" "SeatStatus" NOT NULL,
    "remainingSeats" INTEGER,
    "reservationUrl" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatEvent" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "trainNo" TEXT NOT NULL,
    "seatClass" "SeatClass" NOT NULL,
    "fromStatus" "SeatStatus" NOT NULL,
    "toStatus" "SeatStatus" NOT NULL,
    "remainingSeats" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckRun" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "provider" TEXT NOT NULL,
    "status" "CheckStatus" NOT NULL,
    "trainsFound" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "trainNo" TEXT NOT NULL,
    "seatClass" "SeatClass" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cyclesCompleted" INTEGER NOT NULL DEFAULT 0,
    "groupsChecked" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_watchTokenHash_key" ON "User"("watchTokenHash");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "WatchGroup_active_nextCheckAt_idx" ON "WatchGroup"("active", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchGroup_provider_departureStationCode_arrivalStationCode_key" ON "WatchGroup"("provider", "departureStationCode", "arrivalStationCode", "travelDate");

-- CreateIndex
CREATE INDEX "Alert_userId_createdAt_idx" ON "Alert"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_enabled_expiresAt_idx" ON "Alert"("enabled", "expiresAt");

-- CreateIndex
CREATE INDEX "Alert_groupId_idx" ON "Alert"("groupId");

-- CreateIndex
CREATE INDEX "AlertSeatState_alertId_idx" ON "AlertSeatState"("alertId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSeatState_alertId_trainNo_seatClass_key" ON "AlertSeatState"("alertId", "trainNo", "seatClass");

-- CreateIndex
CREATE INDEX "TrainSnapshot_groupId_checkedAt_idx" ON "TrainSnapshot"("groupId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainSnapshot_groupId_trainNo_seatClass_key" ON "TrainSnapshot"("groupId", "trainNo", "seatClass");

-- CreateIndex
CREATE INDEX "SeatEvent_groupId_occurredAt_idx" ON "SeatEvent"("groupId", "occurredAt");

-- CreateIndex
CREATE INDEX "SeatEvent_occurredAt_idx" ON "SeatEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "CheckRun_startedAt_idx" ON "CheckRun"("startedAt");

-- CreateIndex
CREATE INDEX "CheckRun_status_startedAt_idx" ON "CheckRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "NotificationLog_sentAt_idx" ON "NotificationLog"("sentAt");

-- CreateIndex
CREATE INDEX "NotificationLog_alertId_sentAt_idx" ON "NotificationLog"("alertId", "sentAt");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WatchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertSeatState" ADD CONSTRAINT "AlertSeatState_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainSnapshot" ADD CONSTRAINT "TrainSnapshot_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WatchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatEvent" ADD CONSTRAINT "SeatEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WatchGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckRun" ADD CONSTRAINT "CheckRun_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WatchGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
