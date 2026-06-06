import { Body, Controller, Get, Header, Param, Post, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { rateLimit } from "../../common/rate-limit";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { UploadImageDto } from "./dto";
import { UploadsService } from "./uploads.service";

@Controller("uploads")
@UseGuards(AuthGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Throttle({ default: { ttl: 60_000, limit: rateLimit(20) } })
  @Post("images")
  saveImage(@Body() dto: UploadImageDto) {
    return this.uploads.saveImage(dto);
  }

  @Public()
  @Get("images/:fileName")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  async image(@Param("fileName") fileName: string, @Res() response: any) {
    const image = await this.uploads.imageStream(fileName);
    response.type(image.contentType);
    image.stream.pipe(response);
  }
}
