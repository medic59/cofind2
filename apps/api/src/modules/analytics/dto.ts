import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CollectEventDto {
  // "pageview" or a short event name like "listing_created". Free-form but
  // length-capped; the server keeps only a small whitelist of event names.
  @IsString()
  @MaxLength(60)
  type!: string;

  @IsString()
  @MaxLength(300)
  path!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  referrer?: string;
}

export class AnalyticsRangeDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
