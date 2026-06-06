import { Transform } from "class-transformer";
import { IsIn, IsString, Matches, MaxLength } from "class-validator";

export class UploadImageDto {
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MaxLength(500_000)
  @Matches(/^data:image\/(png|jpeg|webp);base64,/i)
  dataUrl!: string;

  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsIn(["avatar", "drawing", "background", "cover"])
  purpose!: string;
}
