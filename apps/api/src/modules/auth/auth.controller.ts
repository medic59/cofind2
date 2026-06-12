import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { rateLimit } from "../../common/rate-limit";
import { AuthGuard } from "./auth.guard";
import { CurrentUser, RequestUser } from "./current-user.decorator";
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  DeactivateAccountDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  RequestPasswordResetDto,
  UpdateProfileDto
} from "./dto";
import { Public } from "./public.decorator";
import { AuthService } from "./auth.service";

@ApiTags("Auth")
@Controller()
@UseGuards(AuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(8) } })
  @Post("auth/register")
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: any) {
    const session = await this.auth.register(dto);
    this.auth.setSessionCookies(response, session);
    return session;
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(12) } })
  @Post("auth/login")
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: any) {
    const session = await this.auth.login(dto);
    this.auth.setSessionCookies(response, session);
    return session;
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(30) } })
  @Post("auth/refresh")
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: any, @Res({ passthrough: true }) response: any) {
    const session = await this.auth.refreshFromDtoOrCookie(dto, request.headers?.cookie);
    this.auth.setSessionCookies(response, session);
    return session;
  }


  @Public()
  @HttpCode(204)
  @Post("auth/logout")
  logout(@Res({ passthrough: true }) response: any) {
    this.auth.clearSessionCookies(response);
  }

  @Public()
  @HttpCode(204)
  @Get("auth/require-staff")
  async requireStaff(@Req() request: any) {
    await this.auth.requireStaffFromCookie(request.headers?.cookie);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(5, 120) } })
  @Post("auth/password-reset/request")
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.auth.requestPasswordReset(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(10, 120) } })
  @Post("auth/password-reset/confirm")
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.auth.confirmPasswordReset(dto);
  }

  // Opened from the verification email; verifies then redirects back to the SPA.
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(20, 120) } })
  @Get("auth/verify-email")
  async verifyEmail(@Req() request: any, @Res() response: any) {
    const token = String(request.query?.token || "");
    const result = await this.auth.verifyEmail(token);
    const web = (process.env.PUBLIC_WEB_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/+$/, "");
    response.redirect(302, `${web}/me?verified=${result.ok ? "1" : "0"}`);
  }

  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(4, 120) } })
  @Post("auth/resend-verification")
  resendVerification(@CurrentUser() user: RequestUser) {
    return this.auth.resendVerification(user.id);
  }

  @ApiBearerAuth()
  @Get("auth/me")
  me(@CurrentUser() user: RequestUser) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth()
  @Get("me/profile")
  profile(@CurrentUser() user: RequestUser) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth()
  @Patch("me/profile")
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(6, 120) } })
  @Post("auth/change-password")
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto);
  }

  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(4, 120) } })
  @Post("auth/deactivate")
  deactivate(@CurrentUser() user: RequestUser, @Body() dto: DeactivateAccountDto) {
    return this.auth.deactivate(user.id, dto);
  }
}
