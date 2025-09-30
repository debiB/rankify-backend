-- CreateTable
CREATE TABLE `KeywordCannibalizationAudit` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `auditType` ENUM('INITIAL', 'SCHEDULED') NOT NULL DEFAULT 'SCHEDULED',
    `status` ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `totalKeywords` INTEGER NOT NULL DEFAULT 0,
    `cannibalizationCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KeywordCannibalizationAudit_campaignId_idx`(`campaignId`),
    INDEX `KeywordCannibalizationAudit_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KeywordCannibalizationResult` (
    `id` VARCHAR(191) NOT NULL,
    `auditId` VARCHAR(191) NOT NULL,
    `keyword` VARCHAR(191) NOT NULL,
    `topPageUrl` TEXT NOT NULL,
    `topPageImpressions` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KeywordCannibalizationResult_auditId_idx`(`auditId`),
    INDEX `KeywordCannibalizationResult_keyword_idx`(`keyword`),
    UNIQUE INDEX `KeywordCannibalizationResult_auditId_keyword_key`(`auditId`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `KeywordCompetingPage` (
    `id` VARCHAR(191) NOT NULL,
    `resultId` VARCHAR(191) NOT NULL,
    `pageUrl` TEXT NOT NULL,
    `impressions` INTEGER NOT NULL,
    `clicks` INTEGER NOT NULL,
    `position` DOUBLE NOT NULL,
    `overlapPercentage` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KeywordCompetingPage_resultId_idx`(`resultId`),
    INDEX `KeywordCompetingPage_overlapPercentage_idx`(`overlapPercentage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `KeywordCannibalizationAudit` ADD CONSTRAINT `KeywordCannibalizationAudit_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KeywordCannibalizationResult` ADD CONSTRAINT `KeywordCannibalizationResult_auditId_fkey` FOREIGN KEY (`auditId`) REFERENCES `KeywordCannibalizationAudit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `KeywordCompetingPage` ADD CONSTRAINT `KeywordCompetingPage_resultId_fkey` FOREIGN KEY (`resultId`) REFERENCES `KeywordCannibalizationResult`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
