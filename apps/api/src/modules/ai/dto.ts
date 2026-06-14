import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class ListingDraftDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;
}
