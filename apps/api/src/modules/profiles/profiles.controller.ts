import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { PublicProfileQueryDto } from "./dto";
import { ProfilesService } from "./profiles.service";

@ApiTags("Profiles")
@Public()
@Controller("profiles")
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get(":username")
  publicProfile(@Param("username") username: string, @Query() query: PublicProfileQueryDto) {
    return this.profiles.publicProfile(username, query);
  }
}
