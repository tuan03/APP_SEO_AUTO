-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "qa" JSONB,
ADD COLUMN     "research" JSONB;

-- CreateTable
CREATE TABLE "KeywordTarget" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "proposalId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'BASELINE',
    "market" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "primary" TEXT NOT NULL,
    "secondary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keys" TEXT[],
    "cluster" TEXT NOT NULL,
    "clusterKey" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "buyerNeed" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceLevel" TEXT NOT NULL,
    "contentFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordDecision" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "leftId" TEXT NOT NULL,
    "rightId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryMetric" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "clicks" DOUBLE PRECISION NOT NULL,
    "impressions" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "QueryMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KeywordTarget_proposalId_key" ON "KeywordTarget"("proposalId");

-- CreateIndex
CREATE INDEX "KeywordTarget_storeId_state_market_language_clusterKey_idx" ON "KeywordTarget"("storeId", "state", "market", "language", "clusterKey");

-- CreateIndex
CREATE INDEX "KeywordTarget_storeId_resourceId_state_idx" ON "KeywordTarget"("storeId", "resourceId", "state");

-- CreateIndex
CREATE INDEX "KeywordTarget_keys_idx" ON "KeywordTarget" USING GIN ("keys");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordDecision_storeId_pairKey_key" ON "KeywordDecision"("storeId", "pairKey");

-- CreateIndex
CREATE INDEX "QueryMetric_storeId_page_country_date_idx" ON "QueryMetric"("storeId", "page", "country", "date");

-- CreateIndex
CREATE UNIQUE INDEX "QueryMetric_storeId_date_page_query_country_device_key" ON "QueryMetric"("storeId", "date", "page", "query", "country", "device");

-- AddForeignKey
ALTER TABLE "KeywordTarget" ADD CONSTRAINT "KeywordTarget_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordTarget" ADD CONSTRAINT "KeywordTarget_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordDecision" ADD CONSTRAINT "KeywordDecision_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryMetric" ADD CONSTRAINT "QueryMetric_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

