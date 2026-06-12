import { Global, Module } from "@nestjs/common";
import { MailTestController } from "./mail-test.controller";
import { NotificationEmailService } from "./notification-email.service";
import { UnsubscribeController } from "./unsubscribe.controller";

// Global so any module (listings, messaging) can inject NotificationEmailService
// without importing this module explicitly.
@Global()
@Module({
  controllers: [UnsubscribeController, MailTestController],
  providers: [NotificationEmailService],
  exports: [NotificationEmailService]
})
export class NotificationsModule {}
