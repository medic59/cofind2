import { Body, Controller, Headers, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import { rateLimit } from "../../common/rate-limit";
import { Public } from "../auth/public.decorator";
import { PaymentWebhookDto } from "./dto";
import { PaymentsService } from "./payments.service";

@ApiTags("Payments")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(60) } })
  @Post("webhook")
  webhook(@Body() dto: PaymentWebhookDto, @Headers("x-cofind-webhook-secret") secret?: string) {
    return this.payments.webhook(dto, secret);
  }
}
