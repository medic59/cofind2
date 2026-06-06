import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { PublicAdsQueryDto, SeoPageQueryDto } from "./dto";
import { PublicService } from "./public.service";

@ApiTags("Public")
@Public()
@Controller()
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get("subscription/plans")
  plans() {
    return this.publicService.plans();
  }

  @Get("settings")
  settings() {
    return this.publicService.settings();
  }

  @Get("ads/placements")
  ads(@Query() query: PublicAdsQueryDto) {
    return this.publicService.ads(query.position);
  }

  @Get("seo/page")
  seoPage(@Query() query: SeoPageQueryDto) {
    return this.publicService.seoPage(query.path || "/");
  }
}
