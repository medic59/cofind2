import { Controller, Get, NotFoundException, Param, Query, Res } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { toPublicProfile } from "../../common/public-view";
import { Public } from "../auth/public.decorator";
import { PublicProfileQueryDto } from "./dto";
import { renderProfileNotFound, renderProfilePage } from "./profile-page.renderer";
import { ProfilesService } from "./profiles.service";

function publicWebUrl() {
  return String(process.env.PUBLIC_WEB_URL || "").split(",")[0].trim().replace(/\/+$/, "");
}

@ApiTags("Profiles")
@Public()
@Controller("profiles")
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  // Server-rendered profile page (/profile/<username>): correct per-username
  // canonical/OG/Twitter and a real server-rendered listings count, with no
  // internal fields (role/status).
  @ApiExcludeEndpoint()
  @Get(":username/page")
  async page(@Param("username") username: string, @Res() res: any) {
    const webUrl = publicWebUrl();
    try {
      const profile = toPublicProfile(await this.profiles.publicProfile(username));
      res.status(200).type("html").send(renderProfilePage(profile, webUrl, username));
    } catch (error) {
      if (error instanceof NotFoundException) {
        res.status(404).type("html").send(renderProfileNotFound(webUrl));
        return;
      }
      throw error;
    }
  }

  @Get(":username")
  async publicProfile(@Param("username") username: string, @Query() query: PublicProfileQueryDto) {
    return toPublicProfile(await this.profiles.publicProfile(username, query));
  }
}
