import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Controller("api")
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("health")
  health() {
    return { ok: true };
  }

  /** Deliberate N+1: one review query per product, so the duplicates panel has something to show. */
  @Get("products")
  async list() {
    const products = await this.prisma.product.findMany({ orderBy: { id: "asc" } });
    const data: Array<(typeof products)[number] & { reviewCount: number }> = [];

    for (const product of products) {
      const reviews = await this.prisma.review.findMany({
        where: { productId: product.id },
      });
      data.push({ ...product, reviewCount: reviews.length });
    }

    this.logger.log(`listed ${data.length} products`);

    return { data };
  }

  /** One query, one outbound HTTP call and a log line. */
  @Get("products/:id")
  async show(@Param("id", ParseIntPipe) id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { reviews: true },
    });
    if (!product) throw new NotFoundException(`product ${id} not found`);

    const port = process.env.PORT ?? 4100;
    const health = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    this.logger.log(`health check answered ${health.status}`);

    return { data: product };
  }

  /** Rejects an empty name, so the error envelope carries a payload too. */
  @Post("products")
  async create(@Body() body: { name?: string; price?: number }) {
    if (!body?.name) {
      this.logger.warn("rejected product without a name");
      throw new BadRequestException("name is required");
    }

    return {
      data: await this.prisma.product.create({
        data: { name: body.name, price: body.price ?? 0 },
      }),
    };
  }
}
