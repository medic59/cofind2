import { Controller, Get, NotFoundException, Param, Query, Res } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { toPublicProfile } from "../../common/public-view";
import { Public } from "../auth/public.decorator";
import { getProfileOgPng } from "../listings/og-image";
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

  // Dynamic 1200x630 OG card for the profile (served at /profile/<username>/og.png
  // via nginx). Falls back to the brand image on any error.
  @ApiExcludeEndpoint()
  @Get(":username/og.png")
  async og(@Param("username") username: string, @Res() res: any) {
    try {
      const profile = toPublicProfile(await this.profiles.publicProfile(username));
      const png = await getProfileOgPng(profile);
      res.status(200);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(png);
    } catch {
      res.redirect(302, `${publicWebUrl()}/og-image.png`);
    }
  }

  @Get(":username")
  async publicProfile(@Param("username") username: string, @Query() query: PublicProfileQueryDto) {
    return toPublicProfile(await this.profiles.publicProfile(username, query));
  }
}
