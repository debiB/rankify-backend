-- Update existing MANUAL audit types to SCHEDULED
UPDATE `KeywordCannibalizationAudit` SET `auditType` = 'SCHEDULED' WHERE `auditType` = 'MANUAL';
