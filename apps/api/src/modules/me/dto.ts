import { Transform } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

const imageUrlPattern = /^(https?:\/\/\S+|data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+)$/i;

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  theme?: string;

  @IsOptional()
  @IsString()
  accentColor?: string;

  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  textColor?: string;

  @IsOptional()
  @IsString()
  fontSize?: string;

  @IsOptional()
  @IsString()
  fontFamily?: string;

  @IsOptional()
  @IsString()
  dashboardBackgroundType?: string;

  @IsOptional()
  @IsString()
  dashboardBackgroundColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180000)
  @Matches(imageUrlPattern)
  dashboardBackgroundImage?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  dashboardBackgroundOverlay?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(40)
  dashboardBackgroundBlur?: number;

  @IsOptional()
  @IsString()
  dashboardBackgroundPosition?: string;

  @IsOptional()
  @IsString()
  cardStyle?: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(24)
  borderRadius?: number;

  @IsOptional()
  @IsString()
  density?: string;

  @IsOptional()
  @IsString()
  contentWidth?: string;

  @IsOptional()
  @IsBoolean()
  showDecorations?: boolean;

  @IsOptional()
  @IsString()
  animationLevel?: string;

  @IsOptional()
  @IsBoolean()
  showAdultContent?: boolean;
}

export class CheckoutDto {
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/)
  planCode!: string;
}

export class BlockUserDto {
  @IsString()
  userId!: string;
}

export class CreateBackgroundDto {
  @IsString()
  @MaxLength(180000)
  @Matches(imageUrlPattern)
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  position?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  overlay?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(40)
  blur?: number;
}
