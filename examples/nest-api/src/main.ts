import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  createUpspectorMiddleware,
  UPSPECTOR_HEADER,
  UpspectorConsoleLogger,
  installFetchInstrumentation,
  NestUpspectorModule,
} from "@uplide/upspector-nest";
import { upspectorOptions } from "./upspector";
import { PrismaService } from "./prisma.service";
import { ProductsController } from "./products.controller";

@Module({
  imports: [NestUpspectorModule.forRoot(upspectorOptions)],
  controllers: [ProductsController],
  providers: [PrismaService],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new UpspectorConsoleLogger(),
  });

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:4200",
    // Without this the browser hides the header and `fetch` capture skips the body.
    exposedHeaders: [UPSPECTOR_HEADER],
  });

  if (upspectorOptions.enabled) {
    app.use(createUpspectorMiddleware(upspectorOptions));
    installFetchInstrumentation();
  }

  const port = Number(process.env.PORT ?? 4100);
  await app.listen(port);
  console.log(`example API on http://localhost:${port} (upspector ${upspectorOptions.enabled ? "on" : "off"})`);
}

void bootstrap();
