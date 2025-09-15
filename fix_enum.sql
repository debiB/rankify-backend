-- First update any existing MANUAL records to SCHEDULED
UPDATE `KeywordCannibalizationAudit` SET `auditType` = 'SCHEDULED' WHERE `auditType` = 'MANUAL';

-- Drop the existing enum and recreate it without MANUAL
ALTER TABLE `KeywordCannibalizationAudit` MODIFY COLUMN `auditType` ENUM('INITIAL', 'SCHEDULED') NOT NULL DEFAULT 'SCHEDULED';
