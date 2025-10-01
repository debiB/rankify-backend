-- AlterTable

ALTER TABLE `KeywordCannibalizationAudit` MODIFY `auditType` ENUM('CUSTOM', 'INITIAL', 'SCHEDULED') NOT NULL DEFAULT 'SCHEDULED';

