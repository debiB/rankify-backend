/*
  Warnings:

  - The values [PENDING] on the enum `User_status` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `User` ADD COLUMN `hasChangedPassword` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE';
