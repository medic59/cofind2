import { PrismaService } from "../modules/prisma/prisma.service";

export const MONETIZATION_ENABLED_KEY = "features.monetizationEnabled";

type SystemSettingsClient = Pick<PrismaService, "systemSetting">;

export type PublicFeatureFlags = {
  monetizationEnabled: boolean;
};

export async function publicFeatureFlags(prisma: SystemSettingsClient): Promise<PublicFeatureFlags> {
  return {
    monetizationEnabled: await isMonetizationEnabled(prisma)
  };
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
