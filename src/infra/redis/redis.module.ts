import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import Redis from "ioredis";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";

export const REDIS = Symbol("REDIS");

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      // maxRetriesPerRequest: null é exigido pelo BullMQ, que usará esta conexão.
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
