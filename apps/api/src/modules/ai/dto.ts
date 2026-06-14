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

export class CreateRpSessionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fandom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  character?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  userRole?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  style?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tempo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  setting?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  boundaries?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  ageRating?: string;
}

export class RpMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
