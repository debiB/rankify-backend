-- CreateTable
CREATE TABLE `BrandProfile` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `toneData` JSON NOT NULL,
    `lastUpdated` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BrandProfileUrl` (
    `id` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `brandProfileId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BrandProfileUrl_brandProfileId_idx`(`brandProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BrandProfilePdf` (
    `id` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `brandProfileId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BrandProfilePdf_brandProfileId_idx`(`brandProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BrandProfileOtherDoc` (
    `id` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `brandProfileId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BrandProfileOtherDoc_brandProfileId_idx`(`brandProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BrandProfileUrl` ADD CONSTRAINT `BrandProfileUrl_brandProfileId_fkey` FOREIGN KEY (`brandProfileId`) REFERENCES `BrandProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BrandProfilePdf` ADD CONSTRAINT `BrandProfilePdf_brandProfileId_fkey` FOREIGN KEY (`brandProfileId`) REFERENCES `BrandProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BrandProfileOtherDoc` ADD CONSTRAINT `BrandProfileOtherDoc_brandProfileId_fkey` FOREIGN KEY (`brandProfileId`) REFERENCES `BrandProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
