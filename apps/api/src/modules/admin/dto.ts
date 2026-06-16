import {
  AdPosition,
  AdStatus,
  BanType,
  CatalogStatus,
  ListingStatus,
  ModerationStatus,
  ReportStatus,
  SuggestionStatus,
  UserRole,
  UserStatus
} from "@prisma/client";
import { Transform } from "class-transformer";
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, MaxLength, Min, MinLength } from "class-validator";

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}

export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}

export class BanUserDto {
  @IsEnum(BanType)
  type!: BanType;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MaxLength(4000)
  reason!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class ModerateListingDto {
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  @IsOptional()
  @IsEnum(ModerationStatus)
  moderationStatus?: ModerationStatus;
}

export class ResolveReportDto {
  @IsEnum(ReportStatus)
  status!: ReportStatus;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(4000)
  resolutionComment?: string;
}

export class ModerateSuggestionDto {
  @IsEnum(SuggestionStatus)
  status!: SuggestionStatus;

  @IsOptional()
  @IsString()
  moderatorComment?: string;
}

export class UpsertCatalogItemDto {
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  slug!: string;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MaxLength(140)
  name!: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CatalogStatus)
  status?: CatalogStatus;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  fandomId?: string;
}

export class UpsertAdPlacementDto {
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  name!: string;

  @IsEnum(AdPosition)
  position!: AdPosition;

  @IsOptional()
  @IsEnum(AdStatus)
  status?: AdStatus;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsUrl({ require_protocol: true, protocols: ["http", "https"] })
  clickUrl?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsUrl({ require_protocol: true, protocols: ["http", "https"] })
  imageUrl?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(4000)
  htmlCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  impressionLimit?: number;

  @IsOptional()
  @IsBoolean()
  hideForPremium?: boolean;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsDateString()
  endsAt?: string;
}

export class UpsertSubscriptionPlanDto {
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  code!: string;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  name!: string;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  description!: string;

  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  currency?: string;

  @IsInt()
  @Min(1)
  durationDays!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpsertSeoPageDto {
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  path!: string;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MaxLength(180)
  title!: string;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MaxLength(320)
  description!: string;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MaxLength(180)
  h1!: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  canonical?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(180)
  ogTitle?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(320)
  ogDescription?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  ogImage?: string;

  @IsOptional()
  @IsBoolean()
  indexable?: boolean;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  seoText?: string;
}

export class UpdateAdminSettingsDto {
  @IsOptional()
  @IsBoolean()
  monetizationEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
}

// AI provider credentials/config (OWNER-only). Per-provider objects carry
// { apiKey?, model?, baseUrl?, folderId? }; an empty apiKey clears the stored key,
// an omitted apiKey keeps the existing one. Keys are encrypted before storage and
// never returned to the client.
export class UpdateAiConfigDto {
  @IsOptional()
  @IsIn(["anthropic", "openai", "deepseek", "yandex"])
  defaultProvider?: string;

  @IsOptional()
  @IsObject()
  anthropic?: Record<string, string>;

  @IsOptional()
  @IsObject()
  openai?: Record<string, string>;

  @IsOptional()
  @IsObject()
  deepseek?: Record<string, string>;

  @IsOptional()
  @IsObject()
  yandex?: Record<string, string>;
}
