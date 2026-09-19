ALTER TABLE "KeywordTarget" ADD COLUMN "appliedContentHash" TEXT;
UPDATE "KeywordTarget" SET "appliedContentHash" = "contentFingerprint" WHERE "state" IN ('ACTIVE', 'BASELINE');
