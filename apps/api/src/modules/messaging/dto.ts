import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateConversationDto {
  @IsArray()
  @ArrayMaxSize(20)
  @Transform(({ value }) =>
    Array.isArray(value) ? [...new Set(value.map((item) => typeof item === "string" ? item.trim() : item).filter(Boolean))] : value
  )
  @IsString({ each: true })
  participantIds!: string[];

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(4000)
  initialMessage?: string;
}

export class DirectConversationDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  participantId!: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(4000)
  initialMessage?: string;
}

export class SendMessageDto {
  @IsString()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @MinLength(1)
  @MaxLength(4000)
  text!: string;
}

export class ListConversationMessagesQueryDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MaxLength(120)
  cursor?: string;
}
