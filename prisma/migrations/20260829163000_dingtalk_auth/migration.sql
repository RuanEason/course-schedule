-- CreateTable
CREATE TABLE `class_schedule_dingtalk_users` (
    `id` VARCHAR(191) NOT NULL,
    `corpId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `unionId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `avatarUrl` TEXT NULL,
    `isAdmin` BOOLEAN NOT NULL DEFAULT false,
    `isBoss` BOOLEAN NOT NULL DEFAULT false,
    `isSenior` BOOLEAN NOT NULL DEFAULT false,
    `lastLoginAt` DATETIME(3) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `class_schedule_auth_sessions` (
    `tokenHash` CHAR(64) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `class_schedule_editor_access_policies` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `editorTitles` JSON NOT NULL,
    `updatedByUserId` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `class_schedule_dingtalk_users_corpId_userId_key`
    ON `class_schedule_dingtalk_users`(`corpId`, `userId`);

-- CreateIndex
CREATE UNIQUE INDEX `class_schedule_dingtalk_users_corpId_unionId_key`
    ON `class_schedule_dingtalk_users`(`corpId`, `unionId`);

-- CreateIndex
CREATE INDEX `class_schedule_dingtalk_users_title_idx`
    ON `class_schedule_dingtalk_users`(`title`);

-- CreateIndex
CREATE INDEX `class_schedule_auth_sessions_userId_idx`
    ON `class_schedule_auth_sessions`(`userId`);

-- CreateIndex
CREATE INDEX `class_schedule_auth_sessions_expiresAt_idx`
    ON `class_schedule_auth_sessions`(`expiresAt`);

-- AddForeignKey
ALTER TABLE `class_schedule_auth_sessions`
    ADD CONSTRAINT `class_schedule_auth_sessions_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `class_schedule_dingtalk_users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_schedule_editor_access_policies`
    ADD CONSTRAINT `class_schedule_editor_access_policies_updatedByUserId_fkey`
    FOREIGN KEY (`updatedByUserId`) REFERENCES `class_schedule_dingtalk_users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
