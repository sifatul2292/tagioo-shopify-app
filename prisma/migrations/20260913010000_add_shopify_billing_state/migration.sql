ALTER TABLE "StoreConnection" ADD COLUMN "shopId" TEXT;
ALTER TABLE "StoreConnection" ADD COLUMN "billingPlan" TEXT NOT NULL DEFAULT 'Free';
ALTER TABLE "StoreConnection" ADD COLUMN "billingStatus" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "StoreConnection" ADD COLUMN "billingCycleEnd" DATETIME;
ALTER TABLE "StoreConnection" ADD COLUMN "billingCancelAtEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreConnection" ADD COLUMN "billingMissingSince" DATETIME;
ALTER TABLE "StoreConnection" ADD COLUMN "billingSyncedAt" DATETIME;
ALTER TABLE "StoreConnection" ADD COLUMN "billingLastError" TEXT;
