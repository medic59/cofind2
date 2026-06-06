import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { ChatModule } from "./modules/chat/chat.module";
import { HealthModule } from "./modules/health/health.module";
import { ListingsModule } from "./modules/listings/listings.module";
import { MeModule } from "./modules/me/me.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { ProfilesModule } from "./modules/profiles/profiles.module";
import { PublicModule } from "./modules/public/public.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { SearchModule } from "./modules/search/search.module";
import { UploadsModule } from "./modules/uploads/uploads.module";

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    ProfilesModule,
    ListingsModule,
    CatalogModule,
    ChatModule,
    MessagingModule,
    ReportsModule,
    SearchModule,
    PaymentsModule,
    UploadsModule,
    MeModule,
    PublicModule,
    AdminModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule {}
