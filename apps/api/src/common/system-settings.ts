import { PrismaService } from "../modules/prisma/prisma.service";

export const MONETIZATION_ENABLED_KEY = "features.monetizationEnabled";
export const AI_ENABLED_KEY = "features.aiEnabled";

type SystemSettingsClient = Pick<PrismaService, "systemSetting">;

export type PublicFeatureFlags = {
  monetizationEnabled: boolean;
  aiEnabled: boolean;
};

export async function publicFeatureFlags(prisma: SystemSettingsClient): Promise<PublicFeatureFlags> {
  return {
    monetizationEnabled: await isMonetizationEnabled(prisma),
    aiEnabled: await isAiEnabled(prisma)
  };
}

export async function isAiEnabled(prisma: SystemSettingsClient) {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: AI_ENABLED_KEY },
    select: { value: true }
  });
  return booleanSetting(setting?.value, false);
}

export async function setAiEnabled(prisma: SystemSettingsClient, enabled: boolean) {
  return prisma.systemSetting.upsert({
    where: { key: AI_ENABLED_KEY },
    create: { key: AI_ENABLED_KEY, value: enabled },
    update: { value: enabled }
  });
}

export async function isMonetizationEnabled(prisma: SystemSettingsClient) {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: MONETIZATION_ENABLED_KEY },
    select: { value: true }
  });
  return booleanSetting(setting?.value, false);
}

export async function setMonetizationEnabled(prisma: SystemSettingsClient, enabled: boolean) {
  return prisma.systemSetting.upsert({
    where: { key: MONETIZATION_ENABLED_KEY },
    create: { key: MONETIZATION_ENABLED_KEY, value: enabled },
    update: { value: enabled }
  });
}

function booleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && "enabled" in value) {
    return Boolean((value as { enabled?: unknown }).enabled);
  }
  return fallback;
}
