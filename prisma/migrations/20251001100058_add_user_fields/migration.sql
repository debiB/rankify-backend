-- DropForeignKey
ALTER TABLE `KeywordCannibalizationResult` DROP FOREIGN KEY `KeywordCannibalizationResult_auditId_fkey`;

-- DropIndex
DROP INDEX `KeywordCannibalizationResult_auditId_keyword_key` ON `KeywordCannibalizationResult`;

-- AlterTable
ALTER TABLE `KeywordCannibalizationAudit` MODIFY `auditType` ENUM('CUSTOM', 'INITIAL', 'SCHEDULED') NOT NULL DEFAULT 'CUSTOM',
    MODIFY `totalKeywords` INTEGER NULL,
    MODIFY `cannibalizationCount` INTEGER NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `countryCode` VARCHAR(191) NULL DEFAULT '+972',
    ADD COLUMN `firstName` VARCHAR(191) NULL,
    ADD COLUMN `lastName` VARCHAR(191) NULL,
    ADD COLUMN `phoneNumber` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `AdminNotificationPreferencesGlobal` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `enableEmail` BOOLEAN NOT NULL DEFAULT true,
    `enableWhatsApp` BOOLEAN NOT NULL DEFAULT true,
    `enableAllNotifications` BOOLEAN NOT NULL DEFAULT true,
    `whatsAppGroupId` VARCHAR(191) NULL,
    `campaignId` VARCHAR(191) NULL,
    `positionThresholds` TEXT NULL,
    `clickThresholds` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminNotificationPreferencesGlobal_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_settings` (
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

    UNIQUE INDEX `user_settings_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CampaignUser` ADD CONSTRAINT `CampaignUser_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminNotificationPreferencesGlobal` ADD CONSTRAINT `AdminNotificationPreferencesGlobal_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_settings` ADD CONSTRAINT `user_settings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
