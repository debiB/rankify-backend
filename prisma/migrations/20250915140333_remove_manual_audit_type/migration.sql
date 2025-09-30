/*
  Warnings:

  - The values [MANUAL] on the enum `KeywordCannibalizationAudit_auditType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `KeywordCannibalizationAudit` MODIFY `auditType` ENUM('INITIAL', 'SCHEDULED') NOT NULL DEFAULT 'SCHEDULED';
