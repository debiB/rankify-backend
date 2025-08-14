-- CreateTable
CREATE TABLE `SearchConsoleKeywordAnalytics` (
    `id` VARCHAR(191) NOT NULL,
    `siteUrl` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleKeywordAnalytics_siteUrl_idx`(`siteUrl`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SearchConsoleKeyword` (
    `id` VARCHAR(191) NOT NULL,
    `analyticsId` VARCHAR(191) NOT NULL,
    `keyword` VARCHAR(191) NOT NULL,
    `initialPosition` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleKeyword_keyword_idx`(`keyword`),
    INDEX `SearchConsoleKeyword_analyticsId_keyword_idx`(`analyticsId`, `keyword`),
    UNIQUE INDEX `SearchConsoleKeyword_analyticsId_keyword_key`(`analyticsId`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SearchConsoleKeywordMonthlyStat` (
    `id` VARCHAR(191) NOT NULL,
    `keywordId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `averageRank` DOUBLE NOT NULL,
    `searchVolume` INTEGER NOT NULL,
    `topRankingPageUrl` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleKeywordMonthlyStat_month_year_idx`(`month`, `year`),
    UNIQUE INDEX `SearchConsoleKeywordMonthlyStat_keywordId_month_year_key`(`keywordId`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SearchConsoleTrafficAnalytics` (
    `id` VARCHAR(191) NOT NULL,
    `siteUrl` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleTrafficAnalytics_siteUrl_idx`(`siteUrl`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SearchConsoleTrafficMonthlyClick` (
    `id` VARCHAR(191) NOT NULL,
    `analyticsId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `totalClicks` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleTrafficMonthlyClick_month_year_idx`(`month`, `year`),
    UNIQUE INDEX `SearchConsoleTrafficMonthlyClick_analyticsId_month_year_key`(`analyticsId`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SearchConsoleTrafficDailyClick` (
    `id` VARCHAR(191) NOT NULL,
    `analyticsId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `totalClicks` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleTrafficDailyClick_date_idx`(`date`),
    UNIQUE INDEX `SearchConsoleTrafficDailyClick_analyticsId_date_key`(`analyticsId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SearchConsoleKeyword` ADD CONSTRAINT `SearchConsoleKeyword_analyticsId_fkey` FOREIGN KEY (`analyticsId`) REFERENCES `SearchConsoleKeywordAnalytics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SearchConsoleKeywordMonthlyStat` ADD CONSTRAINT `SearchConsoleKeywordMonthlyStat_keywordId_fkey` FOREIGN KEY (`keywordId`) REFERENCES `SearchConsoleKeyword`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SearchConsoleTrafficMonthlyClick` ADD CONSTRAINT `SearchConsoleTrafficMonthlyClick_analyticsId_fkey` FOREIGN KEY (`analyticsId`) REFERENCES `SearchConsoleTrafficAnalytics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SearchConsoleTrafficDailyClick` ADD CONSTRAINT `SearchConsoleTrafficDailyClick_analyticsId_fkey` FOREIGN KEY (`analyticsId`) REFERENCES `SearchConsoleTrafficAnalytics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
