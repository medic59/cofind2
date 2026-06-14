import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiRpController } from "./ai-rp.controller";
import { AiService } from "./ai.service";

@Module({
  controllers: [AiController, AiRpController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
