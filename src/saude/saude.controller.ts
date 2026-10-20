import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import type Redis from "ioredis";
import type { Pool } from "pg";
import { PG_POOL } from "../infra/database/database.module";
import { REDIS } from "../infra/redis/redis.module";

type Estado = "ok" | "falha";

// A resposta deve chegar antes do timeout de 3 s do healthcheck do Docker.
export const PRAZO_CHECAGEM_MS = 1000;

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
        // A conexão de filas repete comandos indefinidamente. Não enfileirar um novo
        // PING a cada healthcheck enquanto ela estiver desconectada/reconectando.
        if (this.redis.status !== "ready") throw new Error("Redis desconectado");
        if ((await this.redis.ping()) !== "PONG") throw new Error("Redis sem PONG");
      }),
    ]);
    const status: Estado = [postgres, pgTrgm, redis].every((e) => e === "ok") ? "ok" : "falha";
    if (status === "falha") res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status, postgres, pgTrgm, redis };
  }

  private async checar(fn: () => Promise<void>): Promise<Estado> {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          temporizador = setTimeout(() => reject(new Error("Prazo da checagem excedido")), PRAZO_CHECAGEM_MS);
        }),
      ]);
      return "ok";
    } catch {
      return "falha";
    } finally {
      clearTimeout(temporizador);
    }
  }
}
