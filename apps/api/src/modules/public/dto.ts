import { AdPosition } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class PublicAdsQueryDto {
  @IsOptional()
  @IsEnum(AdPosition)
  position?: AdPosition;
}

export class SeoPageQueryDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  path?: string;
}
