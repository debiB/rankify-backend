-- CreateTable
CREATE TABLE `SearchConsoleKeywordDailyStat` (
    `id` VARCHAR(191) NOT NULL,
    `keywordId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `averageRank` DOUBLE NOT NULL,
    `searchVolume` INTEGER NOT NULL,
    `topRankingPageUrl` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleKeywordDailyStat_date_idx`(`date`),
    UNIQUE INDEX `SearchConsoleKeywordDailyStat_keywordId_date_key`(`keywordId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SearchConsoleKeywordDailyStat` ADD CONSTRAINT `SearchConsoleKeywordDailyStat_keywordId_fkey` FOREIGN KEY (`keywordId`) REFERENCES `SearchConsoleKeyword`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
