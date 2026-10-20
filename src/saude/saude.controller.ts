import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import type Redis from "ioredis";
import type { Pool } from "pg";
import { PG_POOL } from "../infra/database/database.module";
import { REDIS } from "../infra/redis/redis.module";

type Estado = "ok" | "falha";

export interface RespostaSaude {
  status: Estado;
  postgres: Estado;
  pgTrgm: Estado;
  redis: Estado;
}

@Controller("health")
export class SaudeController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async verificar(@Res({ passthrough: true }) res: Response): Promise<RespostaSaude> {
    const [postgres, pgTrgm, redis] = await Promise.all([
      this.checar(async () => {
        await this.pool.query("SELECT 1");
      }),
      this.checar(async () => {
        const r = await this.pool.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
        if (r.rowCount !== 1) throw new Error("pg_trgm ausente");
      }),
      this.checar(async () => {
        if ((await this.redis.ping()) !== "PONG") throw new Error("Redis sem PONG");
      }),
    ]);
    const status: Estado = [postgres, pgTrgm, redis].every((e) => e === "ok") ? "ok" : "falha";
    if (status === "falha") res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status, postgres, pgTrgm, redis };
  }

  private async checar(fn: () => Promise<void>): Promise<Estado> {
    try {
      await fn();
      return "ok";
    } catch {
      return "falha";
    }
  }
}
