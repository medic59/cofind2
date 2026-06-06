import { ReportEntityType, ReportReason } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateReportDto {
  @IsEnum(ReportEntityType)
  entityType!: ReportEntityType;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  entityId!: string;

  @IsEnum(ReportReason)
  reason!: ReportReason;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  comment?: string;
}
