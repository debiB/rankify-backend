/*
  Warnings:

  - You are about to drop the column `clicks` on the `KeywordCompetingPage` table. All the data in the column will be lost.
  - You are about to drop the column `position` on the `KeywordCompetingPage` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `KeywordCompetingPage` DROP COLUMN `clicks`,
    DROP COLUMN `position`;
