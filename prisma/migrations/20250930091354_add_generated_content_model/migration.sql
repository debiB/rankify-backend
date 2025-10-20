/*
  Warnings:

  - You are about to drop the `GeneratedContent` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `GeneratedContent` DROP FOREIGN KEY `GeneratedContent_contentPlanId_fkey`;

-- DropTable
DROP TABLE `GeneratedContent`;
