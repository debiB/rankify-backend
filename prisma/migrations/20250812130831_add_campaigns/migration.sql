-- CreateTable
CREATE TABLE `Campaign` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startingDate` DATETIME(3) NOT NULL,
    `searchConsoleAccount` VARCHAR(191) NOT NULL,
    `searchConsoleSite` VARCHAR(191) NOT NULL,
    `keywords` TEXT NOT NULL,
    `status` ENUM('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `userId` VARCHAR(191) NOT NULL,
    `googleAccountId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Campaign` ADD CONSTRAINT `Campaign_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Campaign` ADD CONSTRAINT `Campaign_googleAccountId_fkey` FOREIGN KEY (`googleAccountId`) REFERENCES `GoogleAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
