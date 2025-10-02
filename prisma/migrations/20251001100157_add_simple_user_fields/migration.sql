-- AddForeignKey
ALTER TABLE `KeywordCannibalizationResult` ADD CONSTRAINT `KeywordCannibalizationResult_auditId_fkey` FOREIGN KEY (`auditId`) REFERENCES `KeywordCannibalizationAudit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
