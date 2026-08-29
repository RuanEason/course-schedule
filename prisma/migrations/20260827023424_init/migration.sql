-- CreateTable
CREATE TABLE `class_schedule_documents` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `draftConfig` JSON NOT NULL,
    `publishedConfig` JSON NOT NULL,
    `previousPublishedConfig` JSON NULL,
    `draftVersion` INTEGER NOT NULL DEFAULT 1,
    `publishedVersion` INTEGER NOT NULL DEFAULT 1,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
