import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { instrumentPrismaDriverAdapter } from "@uplide/upspector-nest";
import { upspectorOptions } from "./upspector";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      // Upspector wraps the driver adapter, not the client.
      adapter: instrumentPrismaDriverAdapter(
        new PrismaBetterSqlite3({ url: "file:./dev.db" }),
        upspectorOptions,
      ),
    });
  }

  async onModuleInit() {
    if ((await this.product.count()) > 0) return;

    for (const [index, name] of ["Lamp", "Chair", "Desk", "Shelf", "Rug"].entries()) {
      await this.product.create({
        data: {
          name,
          price: (index + 1) * 1250,
          reviews: {
            create: [
              { rating: 5, body: `Great ${name.toLowerCase()}` },
              { rating: 3, body: "Fine" },
            ],
          },
        },
      });
    }
  }
}
