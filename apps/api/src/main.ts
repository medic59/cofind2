import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { assertRuntimeEnv, isSwaggerEnabled, loadDotEnv, parsePublicWebOrigins } from "./common/env";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { ChatRealtimeService } from "./modules/chat/chat-realtime.service";

const { json, urlencoded } = require("express");

async function bootstrap() {
  loadDotEnv();
  assertRuntimeEnv();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  if (process.env.TRUST_PROXY === "true") {
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }
  app.use(json({ limit: "512kb" }));
  app.use(urlencoded({ extended: true, limit: "512kb" }));
  app.use((_request: unknown, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.setGlobalPrefix("api/v1");
  const corsOrigins = parsePublicWebOrigins(process.env.PUBLIC_WEB_URL);
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true
    })
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  if (isSwaggerEnabled()) {
    const config = new DocumentBuilder()
      .setTitle("Cofind 2 API")
      .setDescription("API для платформы поиска соавторов, соигроков и творческих партнеров.")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));
  }

  app.get(ChatRealtimeService).attach(app.getHttpServer());
  const port = Number(process.env.API_PORT || 4000);
  await app.listen(port);
  console.log(`Cofind 2 API is running at http://localhost:${port}/api/v1`);
}

bootstrap();
