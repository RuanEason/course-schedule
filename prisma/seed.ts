import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

import { createBlankConfig } from "../lib/schedule/initial-config";
import { DEFAULT_EDITOR_TITLES } from "../lib/auth/permissions";
import { normalizeScheduleConfig } from "../lib/schedule/normalize";
import type { ScheduleConfig } from "../lib/schedule/types";

const prisma = new PrismaClient();

function loadSeedConfig(): ScheduleConfig {
  try {
    const raw = readFileSync(resolve(process.cwd(), "prisma/seed-config.json"), "utf8");
    return normalizeScheduleConfig(JSON.parse(raw)).config;
  } catch {
    return createBlankConfig();
  }
}

async function main() {
  const config = loadSeedConfig();
  await prisma.scheduleDocument.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      draftConfig: JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue,
      publishedConfig: JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue,
      draftVersion: 1,
      publishedVersion: 1,
      publishedAt: new Date(),
    },
  });

  await prisma.editorAccessPolicy.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      editorTitles: JSON.parse(JSON.stringify(DEFAULT_EDITOR_TITLES)) as Prisma.InputJsonValue,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
