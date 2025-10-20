/*
  Warnings:

  - You are about to drop the column `createdAt` on the `BrandProfileOtherDoc` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `BrandProfilePdf` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `BrandProfileUrl` table. All the data in the column will be lost.
  - You are about to drop the `user_settings` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `updatedAt` to the `GeneratedContent` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `user_settings` DROP FOREIGN KEY `user_settings_userId_fkey`;

-- DropIndex
DROP INDEX `ContentPlan_adminApproved_idx` ON `ContentPlan`;

-- DropIndex
DROP INDEX `GeneratedContent_finalized_idx` ON `GeneratedContent`;

-- AlterTable
ALTER TABLE `BrandProfile` MODIFY `toneData` JSON NULL;

-- AlterTable
ALTER TABLE `BrandProfileOtherDoc` DROP COLUMN `createdAt`;

-- AlterTable
ALTER TABLE `BrandProfilePdf` DROP COLUMN `createdAt`;

-- AlterTable
ALTER TABLE `BrandProfileUrl` DROP COLUMN `createdAt`;

-- AlterTable
ALTER TABLE `GeneratedContent` ADD COLUMN `articleContent` JSON NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL,
    MODIFY `articleText` LONGTEXT NULL,
    MODIFY `style` TEXT NOT NULL,
    MODIFY `externalLink` TEXT NULL;

-- AlterTable
ALTER TABLE `SearchConsoleTrafficDaily` MODIFY `position` DOUBLE NULL;

-- AlterTable
ALTER TABLE `User` MODIFY `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER';

-- DropTable
DROP TABLE `user_settings`;

-- CreateTable
CREATE TABLE `UserSettings` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `enableNotifications` BOOLEAN NOT NULL DEFAULT true,
    `notificationSound` BOOLEAN NOT NULL DEFAULT true,
    `doNotDisturbMode` BOOLEAN NOT NULL DEFAULT false,
    `emailNotifications` BOOLEAN NOT NULL DEFAULT true,
    `systemLanguage` VARCHAR(191) NOT NULL DEFAULT 'en',
    `systemTheme` VARCHAR(191) NOT NULL DEFAULT 'dark',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserSettings_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TopKeywordData` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `keyword` VARCHAR(500) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `averageRank` DOUBLE NOT NULL,
    `clicks` INTEGER NOT NULL,
    `impressions` INTEGER NOT NULL,
    `rankChange` DOUBLE NOT NULL,
    `rankChangeDirection` VARCHAR(191) NOT NULL,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TopKeywordData_campaignId_month_year_idx`(`campaignId`, `month`, `year`),
    INDEX `TopKeywordData_fetchedAt_idx`(`fetchedAt`),
    UNIQUE INDEX `TopKeywordData_campaignId_keyword_month_year_key`(`campaignId`, `keyword`(255), `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `SearchConsoleKeywordMonthlyComputed_keywordId_idx` ON `SearchConsoleKeywordMonthlyComputed`(`keywordId`);

-- AddForeignKey
ALTER TABLE `UserSettings` ADD CONSTRAINT `UserSettings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TopKeywordData` ADD CONSTRAINT `TopKeywordData_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
