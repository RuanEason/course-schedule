-- CreateTable
CREATE TABLE `class_schedule_editor_presences` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `presenceId` VARCHAR(191) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `class_schedule_editor_presences_userId_presenceId_key`
    ON `class_schedule_editor_presences`(`userId`, `presenceId`);

-- CreateIndex
CREATE INDEX `class_schedule_editor_presences_lastSeenAt_idx`
    ON `class_schedule_editor_presences`(`lastSeenAt`);

-- AddForeignKey
ALTER TABLE `class_schedule_editor_presences`
    ADD CONSTRAINT `class_schedule_editor_presences_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `class_schedule_dingtalk_users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
