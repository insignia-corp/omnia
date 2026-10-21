import { z } from "zod";

/** Similaridade mínima (pg_trgm) para ligar sozinho; vale para a nota e para a busca de produto das ferramentas. */
export const LIMITE_SIMILARIDADE_PADRAO = 0.45;

/**
 * Esquema das variáveis de ambiente. A aplicação não sobe com configuração inválida.
 * Segredos ficam só no ambiente (regra inviolável 12); veja .env.example.
 */
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const esquemaEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  // Agente e modelo de linguagem
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_MODELO: z.string().min(1).default("claude-opus-5-5"),
  /** Esforço do modelo no relatório diário e na nota processada. */
  LLM_ESFORCO: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  /** Esforço na conversa com o dono: resposta curta, latência menor (especificação dos agentes, seção 4). */
  LLM_ESFORCO_CONVERSA: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** Novas tentativas do SDK em 408, 409, 429, 5xx e erro de conexão, com espera exponencial. */
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AGENTE_MAX_ITERACOES: z.coerce.number().int().min(1).max(20).default(8),
  AGENTE_MAX_REGERACOES: z.coerce.number().int().min(0).max(5).default(2),
  /** Validade de uma ação à espera do "sim" do dono (ex.: preço-meta). Depois disso, o "sim" não vale. */
  ACAO_EXPIRA_MINUTOS: z.coerce.number().int().min(1).max(1440).default(1440),
  /** Tempo total de uma execução do agente; depois dele o dono recebe o fallback de erro. */
  AGENTE_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  /** Quantas falas anteriores da conversa o agente recebe (0 desliga o histórico). */
  AGENTE_HISTORICO_TURNOS: z.coerce.number().int().min(0).max(40).default(10),

  // Ingestão
  LIMITE_CONFIANCA_ITEM: z.coerce.number().min(0).max(1).default(0.8),
  /** Similaridade (pg_trgm, 0 a 1) a partir da qual a descrição da nota liga sozinha a um produto. */
  LIMITE_SIMILARIDADE: z.coerce.number().min(0).max(1).default(LIMITE_SIMILARIDADE_PADRAO),
  EXTRATOR_MODELO: z.string().min(1).default("claude-sonnet-5-5"),
  /** Modelo que sugere o vínculo item-produto quando código de barras e similaridade falham. */
  VINCULO_MODELO: z.string().min(1).default("claude-haiku-5-5"),
  ARMAZENAMENTO_DIR: z.string().min(1).default("./.dados/arquivos"),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),

  // LGPD
  RETENCAO_MESES: z.coerce.number().int().positive().default(24),

  // Canal: "web" (chat web, padrão para a regional) ou "whatsapp"
  CANAL: z.enum(["web", "whatsapp"]).default("web"),

  // Relatório diário (#64): horário em cron, fuso e janela de silêncio (HH:MM, pode virar a meia-noite)
  FUSO_HORARIO: z.string().min(1).default("America/Sao_Paulo"),
  RELATORIO_DIARIO_CRON: z.string().min(1).default("0 8 * * *"),
  SILENCIO_INICIO: z.string().regex(HORA, "use HH:MM").default("22:00"),
  /** Só para a demo: trava a data do sistema (AAAA-MM-DD) para ela cair dentro do período dos dados de teste. */
  DEMO_DATA_REFERENCIA: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD")
    // `Date.parse` aceita "2026-02-30" e rola para março: a data precisa voltar igual.
    .refine((d) => {
      const t = Date.parse(`${d}T00:00:00Z`);
      return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
    }, "data inválida")
    .optional(),
  SILENCIO_FIM: z.string().regex(HORA, "use HH:MM").default("07:00"),
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
