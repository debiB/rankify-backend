/*
  Warnings:

  - You are about to drop the `SearchConsoleTrafficDailyClick` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `searchconsoletrafficmonthlyclick` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `SearchConsoleTrafficDailyClick` DROP FOREIGN KEY `SearchConsoleTrafficDailyClick_analyticsId_fkey`;

-- DropForeignKey
ALTER TABLE `searchconsoletrafficmonthlyclick` DROP FOREIGN KEY `SearchConsoleTrafficMonthlyClick_analyticsId_fkey`;

-- DropTable
DROP TABLE `SearchConsoleTrafficDailyClick`;

-- DropTable
DROP TABLE `searchconsoletrafficmonthlyclick`;

-- CreateTable
CREATE TABLE `SearchConsoleTrafficMonthly` (
    `id` VARCHAR(191) NOT NULL,
    `analyticsId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `clicks` INTEGER NOT NULL,
    `impressions` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleTrafficMonthly_month_year_idx`(`month`, `year`),
    UNIQUE INDEX `SearchConsoleTrafficMonthly_analyticsId_month_year_key`(`analyticsId`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SearchConsoleTrafficDaily` (
    `id` VARCHAR(191) NOT NULL,
    `analyticsId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `clicks` INTEGER NOT NULL,
    `impressions` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SearchConsoleTrafficDaily_date_idx`(`date`),
    UNIQUE INDEX `SearchConsoleTrafficDaily_analyticsId_date_key`(`analyticsId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SearchConsoleTrafficMonthly` ADD CONSTRAINT `SearchConsoleTrafficMonthly_analyticsId_fkey` FOREIGN KEY (`analyticsId`) REFERENCES `SearchConsoleTrafficAnalytics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SearchConsoleTrafficDaily` ADD CONSTRAINT `SearchConsoleTrafficDaily_analyticsId_fkey` FOREIGN KEY (`analyticsId`) REFERENCES `SearchConsoleTrafficAnalytics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
