import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AdminService } from "./admin.service";
import {
  ModerateListingDto,
  ModerateSuggestionDto,
  BanUserDto,
  ResolveReportDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
  UpsertAdPlacementDto,
  UpsertCatalogItemDto,
  UpsertSeoPageDto,
  UpsertSubscriptionPlanDto,
  UpdateAdminSettingsDto,
  UpdateAiConfigDto
} from "./dto";

const staffRoles = [UserRole.ADMIN, UserRole.OWNER, UserRole.MODERATOR];

@ApiTags("Admin")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(AuthGuard, RolesGuard)
@Roles(...staffRoles)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("dashboard")
  dashboard() {
    return this.admin.dashboard();
  }

  @Get("settings")
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  settings() {
    return this.admin.settings();
  }

  @Patch("settings")
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateAdminSettingsDto) {
    return this.admin.updateSettings(user.id, dto);
  }

  @Get("ai-config")
  @Roles(UserRole.OWNER)
  aiConfig() {
    return this.admin.aiConfig();
  }

  @Patch("ai-config")
  @Roles(UserRole.OWNER)
  updateAiConfig(@CurrentUser() user: RequestUser, @Body() dto: UpdateAiConfigDto) {
    return this.admin.updateAiConfig(user.id, dto);
  }

  @Get("ai-config/balance/:provider")
  @Roles(UserRole.OWNER)
  aiBalance(@Param("provider") provider: string) {
    return this.admin.aiBalance(provider);
  }

  @Get("users")
  users() {
    return this.admin.users();
  }

  @Patch("users/:id/status")
  updateUserStatus(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: UpdateUserStatusDto) {
    return this.admin.updateUserStatus(user.id, id, dto);
  }

  @Patch("users/:id/role")
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  updateUserRole(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: UpdateUserRoleDto) {
    return this.admin.updateUserRole(user.id, id, dto);
  }

  @Patch("users/:id/ban")
  banUser(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: BanUserDto) {
    return this.admin.banUser(user.id, id, dto);
  }

  @Patch("users/:id/unban")
  unbanUser(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.admin.unbanUser(user.id, id);
  }

  @Get("listings")
  listings() {
    return this.admin.listings();
  }

  @Patch("listings/:id/moderate")
  moderateListing(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: ModerateListingDto) {
    return this.admin.moderateListing(user.id, id, dto);
  }

  @Get("reports")
  reports() {
    return this.admin.reports();
  }

  @Patch("reports/:id")
  resolveReport(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: ResolveReportDto) {
    return this.admin.resolveReport(user.id, id, dto);
  }

  @Get("suggestions")
  suggestions() {
    return this.admin.suggestions();
  }

  @Patch("suggestions/:id")
  moderateSuggestion(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: ModerateSuggestionDto) {
    return this.admin.moderateSuggestion(user.id, id, dto);
  }

  @Get("tags")
  tags() {
    return this.admin.tags();
  }

  @Patch("tags/:slug")
  upsertTag(@CurrentUser() user: RequestUser, @Param("slug") slug: string, @Body() dto: UpsertCatalogItemDto) {
    return this.admin.upsertTag(user.id, { ...dto, slug });
  }

  @Get("genres")
  genres() {
    return this.admin.genres();
  }

  @Patch("genres/:slug")
  upsertGenre(@CurrentUser() user: RequestUser, @Param("slug") slug: string, @Body() dto: UpsertCatalogItemDto) {
    return this.admin.upsertGenre(user.id, { ...dto, slug });
  }

  @Get("fandoms")
  fandoms() {
    return this.admin.fandoms();
  }

  @Patch("fandoms/:slug")
  upsertFandom(@CurrentUser() user: RequestUser, @Param("slug") slug: string, @Body() dto: UpsertCatalogItemDto) {
    return this.admin.upsertFandom(user.id, { ...dto, slug });
  }

  @Get("characters")
  characters() {
    return this.admin.characters();
  }

  @Patch("characters/:slug")
  upsertCharacter(@CurrentUser() user: RequestUser, @Param("slug") slug: string, @Body() dto: UpsertCatalogItemDto) {
    return this.admin.upsertCharacter(user.id, { ...dto, slug });
  }

  @Get("ads")
  ads() {
    return this.admin.ads();
  }

  @Patch("ads/:id")
  upsertAd(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: UpsertAdPlacementDto) {
    return this.admin.upsertAd(user.id, dto, id === "new" ? undefined : id);
  }

  @Get("subscriptions")
  subscriptions() {
    return this.admin.subscriptions();
  }

  @Get("payments")
  payments() {
    return this.admin.payments();
  }

  @Get("subscription-plans")
  plans() {
    return this.admin.plans();
  }

  @Patch("subscription-plans/:code")
  upsertPlan(@CurrentUser() user: RequestUser, @Param("code") code: string, @Body() dto: UpsertSubscriptionPlanDto) {
    return this.admin.upsertPlan(user.id, { ...dto, code });
  }

  @Get("seo-pages")
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  seoPages() {
    return this.admin.seoPages();
  }

  @Patch("seo-pages")
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  upsertSeoPage(@CurrentUser() user: RequestUser, @Body() dto: UpsertSeoPageDto) {
    return this.admin.upsertSeoPage(user.id, dto);
  }

  @Get("audit-log")
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  auditLog() {
    return this.admin.auditLog();
  }
}
