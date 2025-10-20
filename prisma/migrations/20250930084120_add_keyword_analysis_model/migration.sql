-- CreateTable
CREATE TABLE `KeywordAnalysis` (
    `id` VARCHAR(191) NOT NULL,
    `keyword` VARCHAR(191) NOT NULL,
    `pageGoals` JSON NOT NULL,
    `h1Headlines` JSON NOT NULL,
    `h2Headlines` JSON NOT NULL,
    `h3Headlines` JSON NOT NULL,
    `avgWordCount` INTEGER NOT NULL,
    `keywordDensity` DOUBLE NOT NULL,
    `suggestedQA` JSON NOT NULL,
    `recommendedExternalLink` VARCHAR(191) NULL,
    `analysisDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KeywordAnalysis_keyword_idx`(`keyword`),
    INDEX `KeywordAnalysis_analysisDate_idx`(`analysisDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
