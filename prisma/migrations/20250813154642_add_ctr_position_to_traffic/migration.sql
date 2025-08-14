/*
  Warnings:

  - Added the required column `ctr` to the `SearchConsoleTrafficDaily` table without a default value. This is not possible if the table is not empty.
  - Added the required column `position` to the `SearchConsoleTrafficDaily` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ctr` to the `SearchConsoleTrafficMonthly` table without a default value. This is not possible if the table is not empty.
  - Added the required column `position` to the `SearchConsoleTrafficMonthly` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `searchconsoletrafficdaily` ADD COLUMN `ctr` DOUBLE NOT NULL,
    ADD COLUMN `position` DOUBLE NOT NULL;

-- AlterTable
ALTER TABLE `searchconsoletrafficmonthly` ADD COLUMN `ctr` DOUBLE NOT NULL,
    ADD COLUMN `position` DOUBLE NOT NULL;
