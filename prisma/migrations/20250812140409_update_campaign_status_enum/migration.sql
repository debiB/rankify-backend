/*
  Warnings:

  - The values [COMPLETED,CANCELLED] on the enum `Campaign_status` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `campaign` MODIFY `status` ENUM('ACTIVE', 'PAUSED') NOT NULL DEFAULT 'ACTIVE';
