import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  createDebugbarMiddleware,
  DEBUGBAR_HEADER,
  DebugbarConsoleLogger,
  installFetchInstrumentation,
  NestDebugbarModule,
} from "@uplide/debugbar-nest";
import { debugbarOptions } from "./debugbar";
import { PrismaService } from "./prisma.service";
import { ProductsController } from "./products.controller";

@Module({
  imports: [NestDebugbarModule.forRoot(debugbarOptions)],
  controllers: [ProductsController],
  providers: [PrismaService],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new DebugbarConsoleLogger(),
  });

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:4200",
    // Without this the browser hides the header and `fetch` capture skips the body.
    exposedHeaders: [DEBUGBAR_HEADER],
  });

  if (debugbarOptions.enabled) {
    app.use(createDebugbarMiddleware(debugbarOptions));
    installFetchInstrumentation();
  }

  const port = Number(process.env.PORT ?? 4100);
  await app.listen(port);
  console.log(`example API on http://localhost:${port} (debugbar ${debugbarOptions.enabled ? "on" : "off"})`);
}

void bootstrap();
