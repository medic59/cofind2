import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

const optionalAvatarUrlPattern = /^(|gradient-[a-z0-9-]+|https?:\/\/\S+|data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+)$/i;
const optionalImageUrlPattern = /^(|https?:\/\/\S+|data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+)$/i;
const optionalWebsitePattern = /^(|https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?)$/i;
const optionalTelegramPattern = /^(|@?[a-z0-9_]{5,32}|https?:\/\/(t\.me|telegram\.me)\/[a-z0-9_]{5,32})$/i;

export class RegisterDto {
  @ApiProperty({ example: "mira@example.com" })
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: "miraink" })
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  username!: string;

  @ApiProperty({ example: "MiraInk" })
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;
}

export class LoginDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(160)
  newPassword!: string;
}

export class DeactivateAccountDto {
  @IsString()
  password!: string;
}

export class RequestPasswordResetDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsEmail()
  email!: string;
}

export class ConfirmPasswordResetDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(20)
  @MaxLength(160)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(160)
  newPassword!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(4000)
  bio?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(180000)
  @Matches(optionalAvatarUrlPattern)
  avatarUrl?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(180000)
  @Matches(optionalImageUrlPattern)
  coverImageUrl?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  writingStyle?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  literacyLevel?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  preferredPostLength?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  activityLevel?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(240)
  communicationPreferences?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeStringArray(value))
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  favoriteGenres?: string[];

  @IsOptional()
  @Transform(({ value }) => normalizeStringArray(value))
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  favoriteFandoms?: string[];

  @IsOptional()
  @Transform(({ value }) => normalizeStringArray(value))
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  favoriteCharacters?: string[];

  @IsOptional()
  @IsBoolean()
  showLastSeen?: boolean;

  @IsOptional()
  @IsBoolean()
  allowProfileMessages?: boolean;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(240)
  @Matches(optionalWebsitePattern)
  socialWebsite?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  @Matches(optionalTelegramPattern)
  socialTelegram?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  socialDiscord?: string;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return value;
  return [...new Set(value.map((item) => typeof item === "string" ? item.trim() : item).filter(Boolean))];
}
