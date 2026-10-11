-- Multi-class support.
--
-- This migration is additive on purpose. The existing `class_schedule_documents`
-- row keeps its id (`default`), so the already-published schedule, its revision
-- history and the Electron client that reads `/config.json` are untouched.
-- `default` is simply declared to be the first class.
--
-- Statements are written to be re-runnable: a migration that fails partway
-- through (MySQL has no transactional DDL) must be recoverable by running it
-- again rather than by hand-editing the schema.

-- CreateTable
CREATE TABLE IF NOT EXISTS `class_schedule_classes` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `class_schedule_class_members` (
    `id` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `class_schedule_classes_isActive_displayOrder_idx`
    ON `class_schedule_classes`(`isActive`, `displayOrder`);

-- CreateIndex
CREATE UNIQUE INDEX `class_schedule_class_members_classId_userId_key`
    ON `class_schedule_class_members`(`classId`, `userId`);

-- CreateIndex
CREATE INDEX `class_schedule_class_members_userId_idx`
    ON `class_schedule_class_members`(`userId`);

-- AddForeignKey
ALTER TABLE `class_schedule_class_members`
    ADD CONSTRAINT `class_schedule_class_members_classId_fkey`
    FOREIGN KEY (`classId`) REFERENCES `class_schedule_classes`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_schedule_class_members`
    ADD CONSTRAINT `class_schedule_class_members_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `class_schedule_dingtalk_users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: presence becomes per class. Existing heartbeats belong to the
-- first class, which is exactly what the default expresses.
ALTER TABLE `class_schedule_editor_presences`
    ADD COLUMN `classId` VARCHAR(191) NOT NULL DEFAULT 'default';

-- CreateIndex
-- The `(userId, presenceId)` index is left in place: MySQL reuses it to satisfy
-- the `userId` foreign key and refuses to drop it while that constraint exists.
CREATE UNIQUE INDEX `class_schedule_editor_presences_classId_userId_presenceId_key`
    ON `class_schedule_editor_presences`(`classId`, `userId`, `presenceId`);

-- CreateIndex
CREATE INDEX `class_schedule_editor_presences_classId_lastSeenAt_idx`
    ON `class_schedule_editor_presences`(`classId`, `lastSeenAt`);

-- Seed data: declare the pre-existing single schedule as the first class, and
-- give every teacher who could already edit an explicit membership so that
-- per-class permissions do not lock out the current operators.
INSERT INTO `class_schedule_classes` (`id`, `name`, `displayOrder`, `isActive`, `createdAt`, `updatedAt`)
VALUES ('default', '1 班', 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `id` = `id`;

INSERT INTO `class_schedule_class_members` (`id`, `classId`, `userId`, `createdAt`)
SELECT CONCAT('migrated-', `id`), 'default', `id`, CURRENT_TIMESTAMP(3)
FROM `class_schedule_dingtalk_users`
ON DUPLICATE KEY UPDATE `classId` = `classId`;
