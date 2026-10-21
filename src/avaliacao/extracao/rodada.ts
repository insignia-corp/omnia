import { z } from "zod";
import { ClienteVisaoAnthropic } from "../../ingestao/extracao/cliente-visao-anthropic";
import type { ClienteVisao } from "../../ingestao/extracao/cliente-visao";
import { LIMITE_CONFIANCA_ITEM } from "../../ingestao/extracao/esquema-extracao";
import { ExtratorNotas } from "../../ingestao/extracao/extrator-notas";
import { carregarPromptExtrator } from "../../ingestao/extracao/prompt-extrator";
import {
  avaliarExtracao,
  carregarNotas,
  clienteFalsoDoGabarito,
  hojeDoGabarito,
  NOME_MODELO_FALSO,
  type NotaDeTeste,
  type RodadaExtracao,
} from "./runner";

/** Erro de uso da avaliação (chave ausente, nota inexistente): a CLI mostra a mensagem. */
export class ErroAvaliacaoExtracao extends Error {}

/** Só o que a avaliação precisa do ambiente: não exige banco nem Redis, ao contrário de `carregarEnv`. */
const esquemaEnv = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  EXTRATOR_MODELO: z.string().min(1).default("claude-sonnet-5-5"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LIMITE_CONFIANCA_ITEM: z.coerce.number().min(0).max(1).default(LIMITE_CONFIANCA_ITEM),
});
export type EnvExtracao = z.infer<typeof esquemaEnv>;

export function lerEnvExtracao(origem: NodeJS.ProcessEnv = process.env): EnvExtracao {
  const preenchidas = Object.fromEntries(Object.entries(origem).filter(([, v]) => v !== ""));
  const r = esquemaEnv.safeParse(preenchidas);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new ErroAvaliacaoExtracao(
      `Configuração inválida. Confira o .env (modelo em .env.example):\n${problemas}`,
    );
  }
  return r.data;
}

export interface OpcoesRodadaExtracao {
  modo: "falso" | "real";
  env: EnvExtracao;
  /** Só estas notas (ex.: `nota-01`); sem valor, todas as fotos do manifesto. */
  notas?: string[];
  /** Versão do prompt do Extrator, ex.: "v1". */
  prompt?: string;
  /** Sem valor, vale `LIMITE_CONFIANCA_ITEM` do ambiente (0,8). */
  limiteConfianca?: number;
  raiz?: string;
  /** Troca o cliente de visão (testes). Sem valor: o falso no modo falso, a Anthropic no real. */
  cliente?: ClienteVisao;
}

function escolherNotas(todas: NotaDeTeste[], ids: string[] | undefined): NotaDeTeste[] {
  if (!ids) return todas;
  const faltam = ids.filter((id) => !todas.some((n) => n.id === id));
  if (faltam.length > 0) {
    throw new ErroAvaliacaoExtracao(
      `Nota inexistente: ${faltam.join(", ")}. Existem: ${todas.map((n) => n.id).join(", ")}.`,
    );
  }
  return todas.filter((n) => ids.includes(n.id));
}

export async function rodarAvaliacaoExtracao(opcoes: OpcoesRodadaExtracao): Promise<RodadaExtracao> {
  const raiz = opcoes.raiz ?? ".";
  if (opcoes.modo === "real" && !opcoes.cliente && !opcoes.env.ANTHROPIC_API_KEY) {
    throw new ErroAvaliacaoExtracao(
      "--modelo real exige ANTHROPIC_API_KEY (no .env ou no ambiente). Sem chave, use --modelo falso.",
    );
  }
  const notas = escolherNotas(carregarNotas(raiz), opcoes.notas);
  const cliente =
    opcoes.cliente ??
    (opcoes.modo === "falso"
      ? clienteFalsoDoGabarito(notas)
      : new ClienteVisaoAnthropic({
          ...(opcoes.env.ANTHROPIC_API_KEY ? { apiKey: opcoes.env.ANTHROPIC_API_KEY } : {}),
          modelo: opcoes.env.EXTRATOR_MODELO,
          timeoutMs: opcoes.env.LLM_TIMEOUT_MS,
        }));
  const prompt = carregarPromptExtrator(opcoes.prompt ?? "v1");
  return avaliarExtracao({
    extrator: new ExtratorNotas(cliente, prompt),
    notas,
    hoje: hojeDoGabarito(raiz),
    modo: opcoes.modo,
    modelo: opcoes.modo === "falso" ? NOME_MODELO_FALSO : opcoes.env.EXTRATOR_MODELO,
    versaoPrompt: prompt.versao,
    limiteConfianca: opcoes.limiteConfianca ?? opcoes.env.LIMITE_CONFIANCA_ITEM,
  });
}
