CREATE TABLE "StoreConnection" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT,
    "trackingDomain" TEXT NOT NULL,
    "measurementId" TEXT NOT NULL,
    "integrationToken" TEXT NOT NULL,
    "pixelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastOrderAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
