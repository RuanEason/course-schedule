import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

import { createBlankConfig } from "../lib/schedule/initial-config";
import { DEFAULT_EDITOR_TITLES } from "../lib/auth/permissions";
import { normalizeScheduleConfig } from "../lib/schedule/normalize";
import { DEFAULT_CLASS_ID } from "../lib/schedule/classes";
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

/**
 * Additional classes to create, as `slug:name` pairs.
 *
 *   SEED_CLASSES="class2:2 班,class3:3 班" npm run db:seed
 *
 * Classes created this way get an empty schedule; the schedule document is
 * materialised lazily the first time someone opens the class.
 */
function parseExtraClasses(): Array<{ id: string; name: string; displayOrder: number }> {
  const configured = process.env.SEED_CLASSES?.trim();
  if (!configured) return [];
  return configured
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const separator = entry.indexOf(":");
      const id = (separator === -1 ? entry : entry.slice(0, separator)).trim();
      const name = (separator === -1 ? entry : entry.slice(separator + 1)).trim() || id;
      return { id, name, displayOrder: index + 1 };
    })
    .filter((entry) => entry.id && entry.id !== DEFAULT_CLASS_ID);
}

async function seedClass(input: { id: string; name: string; displayOrder: number; config?: ScheduleConfig }) {
  await prisma.class.upsert({
    where: { id: input.id },
    update: { name: input.name, displayOrder: input.displayOrder },
    create: { id: input.id, name: input.name, displayOrder: input.displayOrder },
  });

  if (!input.config) return;
  await prisma.scheduleDocument.upsert({
    where: { id: input.id },
    update: {},
    create: {
      id: input.id,
      draftConfig: JSON.parse(JSON.stringify(input.config)) as Prisma.InputJsonValue,
      publishedConfig: JSON.parse(JSON.stringify(input.config)) as Prisma.InputJsonValue,
      draftVersion: 1,
      publishedVersion: 1,
      publishedAt: new Date(),
    },
  });
}

async function main() {
  const config = loadSeedConfig();

  // `default` keeps its id so the pre-existing document, its published config
  // and the Electron client address stay valid; it is simply the first class.
  await seedClass({ id: DEFAULT_CLASS_ID, name: "1 班", displayOrder: 0, config });

  for (const extra of parseExtraClasses()) {
    await seedClass(extra);
  }

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
