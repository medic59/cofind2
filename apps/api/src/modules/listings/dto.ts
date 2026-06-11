import { AgeRating, FandomMode, ListingType, ResponseStatus } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import { IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";

export class ListListingsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Page size is clamped to [1, 50] in the service (default 20). `limit` is an
  // accepted alias; values above 50 are capped, not rejected.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @IsOptional()
  @IsEnum(AgeRating)
  ageRating?: AgeRating;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  tag?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  genre?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  fandom?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  character?: string;
}

export class CreateListingDto {
  @IsEnum(ListingType)
  type!: ListingType;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MinLength(6)
  @MaxLength(140)
  title!: string;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MinLength(20)
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsEnum(AgeRating)
  ageRating?: AgeRating;

  @IsOptional()
  @IsEnum(FandomMode)
  fandomMode?: FandomMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagSlugs?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genreSlugs?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fandomSlugs?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  characterSlugs?: string[];
}

export class UpdateListingDto {
  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(6)
  @MaxLength(140)
  title?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  body?: string;

  @IsOptional()
  @IsEnum(AgeRating)
  ageRating?: AgeRating;

  @IsOptional()
  @IsEnum(FandomMode)
  fandomMode?: FandomMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagSlugs?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genreSlugs?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fandomSlugs?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  characterSlugs?: string[];
}

export class RespondListingDto {
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MinLength(10)
  @MaxLength(4000)
  message!: string;
}

export class UpdateResponseStatusDto {
  @IsEnum(ResponseStatus)
  status!: ResponseStatus;
}
