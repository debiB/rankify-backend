-- CreateTable
CREATE TABLE `SearchConsoleKeywordMonthlyComputed` (
    `id` VARCHAR(191) NOT NULL,
    `keywordId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `averageRank` DOUBLE NOT NULL,
    `impressions` INTEGER NOT NULL,
    `clicks` INTEGER NOT NULL,
    `topRankingPageUrl` TEXT NOT NULL,
    `calcWindowDays` INTEGER NOT NULL,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleKeywordMonthlyComputed_month_year_idx`(`month`, `year`),
    UNIQUE INDEX `SearchConsoleKeywordMonthlyComputed_keywordId_month_year_key`(`keywordId`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserKeywordFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `keywordId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserKeywordFavorite_userId_idx`(`userId`),
    INDEX `UserKeywordFavorite_keywordId_idx`(`keywordId`),
    UNIQUE INDEX `UserKeywordFavorite_userId_keywordId_key`(`userId`, `keywordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SearchConsoleKeywordMonthlyComputed` ADD CONSTRAINT `SearchConsoleKeywordMonthlyComputed_keywordId_fkey` FOREIGN KEY (`keywordId`) REFERENCES `SearchConsoleKeyword`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserKeywordFavorite` ADD CONSTRAINT `UserKeywordFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserKeywordFavorite` ADD CONSTRAINT `UserKeywordFavorite_keywordId_fkey` FOREIGN KEY (`keywordId`) REFERENCES `SearchConsoleKeyword`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
