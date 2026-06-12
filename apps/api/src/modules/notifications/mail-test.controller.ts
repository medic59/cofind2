import { Controller, Get, Post, Res } from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { capturedEmails, clearCapturedEmails } from "../../common/mail";
import { Public } from "../auth/public.decorator";

// Test-only inspection of the in-memory mail outbox (console provider). Returns
// 404 unless NODE_ENV=test, so it is never exposed in production.
@Public()
@Controller("_mail")
export class MailTestController {
  @Get("outbox")
  @ApiExcludeEndpoint()
  outbox(@Res() res: any) {
    if (process.env.NODE_ENV !== "test") {
      res.status(404).send();
      return;
    }
    res.json(capturedEmails());
  }

  @Post("outbox/clear")
  @ApiExcludeEndpoint()
  clear(@Res() res: any) {
    if (process.env.NODE_ENV !== "test") {
      res.status(404).send();
      return;
    }
    clearCapturedEmails();
    res.json({ ok: true });
  }
}
