import { SuggestionType } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MaxLength, MinLength, IsUrl } from "class-validator";

export class CreateSuggestionDto {
  @IsEnum(SuggestionType)
  type!: SuggestionType;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsUrl({ require_protocol: true })
  sourceUrl?: string;
}
