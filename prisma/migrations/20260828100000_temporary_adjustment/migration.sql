ALTER TABLE `class_schedule_documents`
    ADD COLUMN `temporaryAdjustment` JSON NULL,
    ADD COLUMN `temporaryAdjustmentVersion` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `temporaryAdjustmentUpdatedAt` DATETIME(3) NULL;
