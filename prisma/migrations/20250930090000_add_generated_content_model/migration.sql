-- CreateTable
CREATE TABLE `GeneratedContent` (
    `id` VARCHAR(191) NOT NULL,
    `contentPlanId` VARCHAR(191) NOT NULL,
    `articleText` TEXT NOT NULL,
    `style` VARCHAR(191) NOT NULL,
    `intro` TEXT NOT NULL,
    `qnaSections` JSON NOT NULL,
    `externalLink` VARCHAR(191) NULL,
    `finalized` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GeneratedContent_contentPlanId_idx`(`contentPlanId`),
    INDEX `GeneratedContent_finalized_idx`(`finalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GeneratedContent` ADD CONSTRAINT `GeneratedContent_contentPlanId_fkey` FOREIGN KEY (`contentPlanId`) REFERENCES `ContentPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;