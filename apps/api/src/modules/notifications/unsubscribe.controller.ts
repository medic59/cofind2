import { Controller, Get, Query, Res } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

// One-click unsubscribe from notification emails (no login). The token lives on
// UserPreferences; `type` = response | message | all.
@ApiTags("Notifications")
@Public()
@Controller("unsubscribe")
export class UnsubscribeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiExcludeEndpoint()
  async unsubscribe(@Query("token") token: string, @Query("type") type: string, @Res() res: any) {
    if (!token) {
      res.status(400).type("html").send(page("Не удалось отписаться", "Ссылка неполная — нет токена."));
      return;
    }
    const prefs = await this.prisma.userPreferences.findUnique({ where: { unsubscribeToken: token }, select: { id: true } });
    if (!prefs) {
      res.status(404).type("html").send(page("Ссылка недействительна", "Токен отписки не найден или устарел. Настройки уведомлений можно изменить в личном кабинете."));
      return;
    }
    const data =
      type === "response"
        ? { emailOnResponse: false }
        : type === "message"
          ? { emailOnMessage: false }
          : { emailOnResponse: false, emailOnMessage: false };
    await this.prisma.userPreferences.update({ where: { unsubscribeToken: token }, data });
    const what = type === "response" ? "об откликах" : type === "message" ? "о сообщениях" : "от Cofind 2";
    res.status(200).type("html").send(page("Вы отписались", `Письма ${what} больше приходить не будут. Вернуть их и тонко настроить уведомления можно в личном кабинете.`));
  }
}

function escapeHtml(value: string) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function page(heading: string, message: string) {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)} — Cofind 2</title>
    <meta name="robots" content="noindex,nofollow" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="listing-ssr-page">
    <header class="listing-ssr-topbar"><a class="listing-ssr-brand" href="/">Cofind 2</a></header>
    <main class="listing-ssr-main">
      <article class="listing-ssr-card">
        <h1 class="listing-ssr-title">${escapeHtml(heading)}</h1>
        <p>${escapeHtml(message)}</p>
        <div class="listing-ssr-actions">
          <a class="primary-button" href="/me">Настройки уведомлений</a>
          <a class="ghost-button" href="/">На главную</a>
        </div>
      </article>
    </main>
  </body>
</html>
`;
}
