// Sem .env, os testes e2e usam os mesmos endereços do docker compose.
process.env.DATABASE_URL ??= `postgres://omnia:omnia@localhost:${process.env.POSTGRES_PORTA ?? "5432"}/omnia`;
process.env.REDIS_URL ??= `redis://localhost:${process.env.REDIS_PORTA ?? "6379"}`;
