import { z } from "zod";

/**
 * Esquema das variáveis de ambiente. A aplicação não sobe com configuração inválida.
 * Segredos ficam só no ambiente (regra inviolável 12); veja .env.example.
 */
const esquemaEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  // Agente e modelo de linguagem
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_MODELO: z.string().min(1).default("claude-opus-5-5"),
  LLM_ESFORCO: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  AGENTE_MAX_ITERACOES: z.coerce.number().int().min(1).max(20).default(8),
  AGENTE_MAX_REGERACOES: z.coerce.number().int().min(0).max(5).default(2),

  // Ingestão
  LIMITE_CONFIANCA_ITEM: z.coerce.number().min(0).max(1).default(0.8),

  // LGPD
  RETENCAO_MESES: z.coerce.number().int().positive().default(24),

  // Canal: "web" (chat web, padrão para a regional) ou "whatsapp"
  CANAL: z.enum(["web", "whatsapp"]).default("web"),
});

export type Env = z.infer<typeof esquemaEnv>;

export function carregarEnv(origem: NodeJS.ProcessEnv = process.env): Env {
  // "CHAVE=" vazio no .env conta como não definida, para valer o padrão ou o opcional.
  const preenchidas = Object.fromEntries(Object.entries(origem).filter(([, v]) => v !== ""));
  const resultado = esquemaEnv.safeParse(preenchidas);
  if (!resultado.success) {
    const problemas = resultado.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida. Confira o .env (modelo em .env.example):\n${problemas}`);
  }
  return resultado.data;
}
