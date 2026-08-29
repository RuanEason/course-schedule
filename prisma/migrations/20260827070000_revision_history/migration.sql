ALTER TABLE `class_schedule_documents`
    ADD COLUMN `draftUpdatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE TABLE `class_schedule_revisions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `documentId` VARCHAR(191) NOT NULL DEFAULT 'default',
    `draftVersion` INTEGER NOT NULL,
    `publishedVersion` INTEGER NULL,
    `config` JSON NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `class_schedule_revisions_documentId_createdAt_idx`
    ON `class_schedule_revisions`(`documentId`, `createdAt`);

ALTER TABLE `class_schedule_revisions`
    ADD CONSTRAINT `class_schedule_revisions_documentId_fkey`
    FOREIGN KEY (`documentId`) REFERENCES `class_schedule_documents`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
