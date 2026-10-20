import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import * as schema from "./schema";

export const PG_POOL = Symbol("PG_POOL");
export const DB = Symbol("DB");
export type Db = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        // Sem prazo para obter conexão, pedidos pendentes se acumulam enquanto o banco está fora.
        new Pool({ connectionString: env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 }),
    },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool): Db => drizzle(pool, { schema }) },
  ],
  exports: [PG_POOL, DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
