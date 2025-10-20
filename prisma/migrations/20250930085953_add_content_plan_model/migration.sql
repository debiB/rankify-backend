-- CreateTable
CREATE TABLE `ContentPlan` (
    `id` VARCHAR(191) NOT NULL,
    `keywordAnalysisId` VARCHAR(191) NOT NULL,
    `articleGoal` TEXT NOT NULL,
    `headlines` JSON NOT NULL,
    `subheadings` JSON NOT NULL,
    `recommendedWordCount` INTEGER NOT NULL,
    `keywordPlacement` JSON NOT NULL,
    `adminApproved` BOOLEAN NOT NULL DEFAULT false,
    `style` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContentPlan_keywordAnalysisId_idx`(`keywordAnalysisId`),
    INDEX `ContentPlan_adminApproved_idx`(`adminApproved`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ContentPlan` ADD CONSTRAINT `ContentPlan_keywordAnalysisId_fkey` FOREIGN KEY (`keywordAnalysisId`) REFERENCES `KeywordAnalysis`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
