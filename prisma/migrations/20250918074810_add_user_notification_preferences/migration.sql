-- AlterTable
ALTER TABLE `AdminNotificationPreferences` ADD COLUMN `campaignId` VARCHAR(191) NULL,
    ADD COLUMN `whatsAppGroupId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `UserNotificationPreferences` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `enableEmail` BOOLEAN NOT NULL DEFAULT true,
    `enableWhatsApp` BOOLEAN NOT NULL DEFAULT true,
    `enableAllNotifications` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserNotificationPreferences_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserNotificationPreferences` ADD CONSTRAINT `UserNotificationPreferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
