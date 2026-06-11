import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { toPublicAd, toPublicPlan, toPublicSeoPage } from "../../common/public-view";
import { Public } from "../auth/public.decorator";
import { PublicAdsQueryDto, SeoPageQueryDto } from "./dto";
import { PublicService } from "./public.service";

@ApiTags("Public")
@Public()
@Controller()
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get("subscription/plans")
  async plans() {
    return (await this.publicService.plans()).map(toPublicPlan);
  }

  @Get("settings")
  settings() {
    return this.publicService.settings();
  }

  @Get("ads/placements")
  async ads(@Query() query: PublicAdsQueryDto) {
    return (await this.publicService.ads(query.position)).map(toPublicAd);
  }

  @Get("seo/page")
  async seoPage(@Query() query: SeoPageQueryDto) {
    const page = await this.publicService.seoPage(query.path || "/");
    return page ? toPublicSeoPage(page) : null;
  }
}
