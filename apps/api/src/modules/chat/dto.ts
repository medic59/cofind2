import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class SendGlobalMessageDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsString()
  @IsIn(["general", "partners", "fandoms", "moderation"])
  room?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  quotedGlobalMessageId?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(500_000)
  @Matches(/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i)
  drawingUrl?: string;
}

export class ReactMessageDto {
  @IsString()
  @IsIn(["👍", "❤️", "😂", "😮", "😢", "🔥", "✨", "👀"])
  emoji!: string;
}
