import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { AgenteService } from "../agente/agente.service";
import { RegistroExecucoesPostgres, type RegistroExecucoes } from "../agente/execucao/registro-execucoes";
import { montarCatalogo } from "../agente/ferramentas/catalogo";
import { RegistroFerramentas } from "../agente/ferramentas/registro-ferramentas";
import { ModeloAnthropic } from "../agente/llm/modelo-anthropic";
import type { ModeloLinguagem } from "../agente/llm/modelo-linguagem";
import { carregarPromptSistema } from "../agente/prompts/prompt-sistema";
import type { Env } from "../config/env";
import type { Db } from "../infra/database/database.module";
import { comerciante } from "../infra/database/schema";
import { todosOsCasos } from "./casos/index";
import { dataIsoValida, validarCaso } from "./criterios";
import { ModeloRoteirizado, NOME_MODELO_FALSO } from "./modelo-roteirizado";
import { executarRodada } from "./runner";
import type { CasoAvaliacao, ModoModelo, Rodada } from "./tipos";

/** Erro de uso da avaliação (chave ausente, seed não carregado, caso inexistente): a CLI mostra a mensagem. */
export class ErroAvaliacao extends Error {}

export interface OpcoesAvaliacao {
  db: Db;
  env: Env;
  modo: ModoModelo;
  /** Só estes ids; sem valor, todos os casos. */
  casos?: string[];
  /** Versão do prompt de sistema, ex.: "v5"; sem valor, a do agente em produção. */
  prompt?: string;
  /** Data de hoje para os casos; sem valor, o dia seguinte à data de referência do gabarito. */
  dataReferencia?: string;
  /** Comerciante da rodada; sem valor, o mercadinho do seed (`npm run seed:demo`). */
  comercianteId?: string;
  /** Casos da rodada; sem valor, os de `casos/index.ts`. */
  catalogoDeCasos?: CasoAvaliacao[];
  raiz?: string;
}

interface DadosDoMercadinho {
  nome: string;
  /** "Ontem" nas perguntas do gabarito é a data de referência; hoje é o dia seguinte. */
  hoje: string;
}

function lerJson(raiz: string, arquivo: string): unknown {
  return JSON.parse(readFileSync(resolve(raiz, arquivo), "utf8"));
}

function dadosDoMercadinho(raiz: string): DadosDoMercadinho {
  const perfil = lerJson(raiz, "fixtures/mercadinho/perfil.json") as { nome: string };
  const gabarito = lerJson(raiz, "fixtures/gabarito/metricas.json") as {
    parametros: { data_referencia: string };
  };
  const dia = new Date(`${gabarito.parametros.data_referencia}T00:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + 1);
  return { nome: perfil.nome, hoje: dia.toISOString().slice(0, 10) };
}

async function acharComerciante(db: Db, id: string | undefined, nomeDoSeed: string) {
  const [linha] = await db
    .select({ id: comerciante.id, nome: comerciante.nome })
    .from(comerciante)
    .where(id ? eq(comerciante.id, id) : eq(comerciante.nome, nomeDoSeed))
    .limit(1);
  if (!linha) {
    throw new ErroAvaliacao(
      id
        ? `Comerciante ${id} não existe no banco.`
        : `Comerciante "${nomeDoSeed}" não existe no banco. Rode antes: npm run seed:demo`,
    );
  }
  return linha;
}

/** Ferramentas do catálogo; no modo falso (e no real, nos casos com `dubleNoModoReal`), os dublês do caso ocupam o lugar das de mesmo nome. */
function montarFerramentas(db: Db, caso: CasoAvaliacao, modo: ModoModelo): RegistroFerramentas {
  const doCatalogo = montarCatalogo({ db });
  if (modo === "real" && !caso.dubleNoModoReal) return new RegistroFerramentas(doCatalogo);
  const falsas = caso.ferramentasFalsas ?? [];
  const nomesFalsos = new Set(falsas.map((f) => f.nome));
  return new RegistroFerramentas([...doCatalogo.filter((f) => !nomesFalsos.has(f.nome)), ...falsas]);
}

/**
 * Uma rodada completa: escolhe o modelo pelo modo, roda os casos contra o banco com o seed e devolve
 * o resultado. Gravar o relatório é com quem chama (`gravarRodada`).
 */
export async function rodarAvaliacao(op: OpcoesAvaliacao): Promise<Rodada> {
  const raiz = op.raiz ?? process.cwd();
  // Antes de tocar no banco: sem chave, o modo real não tem como rodar.
  if (op.modo === "real" && !op.env.ANTHROPIC_API_KEY) {
    throw new ErroAvaliacao(
      "O modo real chama a API da Anthropic e precisa de ANTHROPIC_API_KEY no .env ou no ambiente. " +
        "Sem chave, use --modelo falso.",
    );
  }
  if (op.dataReferencia !== undefined && !dataIsoValida(op.dataReferencia)) {
    throw new ErroAvaliacao(`--data "${op.dataReferencia}" não é uma data AAAA-MM-DD válida.`);
  }
  const todos = op.catalogoDeCasos ?? todosOsCasos();
  const ids = op.casos ?? todos.map((c) => c.id);
  const desconhecidos = ids.filter((id) => !todos.some((c) => c.id === id));
  if (desconhecidos.length > 0) {
    throw new ErroAvaliacao(
      `Caso inexistente: ${desconhecidos.join(", ")}. Casos disponíveis: ${todos.map((c) => c.id).join(", ")}`,
    );
  }
  const casos = todos.filter((c) => ids.includes(c.id));
  const problemas = casos.flatMap((c) => validarCaso(c).map((p) => `${c.id}: ${p}`));
  if (problemas.length > 0) throw new ErroAvaliacao(`Caso mal definido:\n  ${problemas.join("\n  ")}`);

  const mercadinho = dadosDoMercadinho(raiz);
  const dono = await acharComerciante(op.db, op.comercianteId, mercadinho.nome);
  const prompt = carregarPromptSistema(op.prompt);
  const { env } = op;

  const criarAgente = (caso: CasoAvaliacao, registro: RegistroExecucoes): AgenteService => {
    let modelo: ModeloLinguagem;
    if (op.modo === "falso") {
      if (!caso.roteiro) throw new ErroAvaliacao(`O caso ${caso.id} não tem roteiro para o modo falso`);
      modelo = new ModeloRoteirizado(caso.roteiro);
    } else {
      modelo = new ModeloAnthropic(env);
    }
    // Mesmos limites e esforços do AgenteModule: a avaliação mede o agente como ele roda.
    return new AgenteService(modelo, montarFerramentas(op.db, caso, op.modo), registro, prompt, {
      maxIteracoes: env.AGENTE_MAX_ITERACOES,
      maxRegeracoes: env.AGENTE_MAX_REGERACOES,
      maxMs: env.AGENTE_TIMEOUT_MS,
      esforcoPorGatilho: {
        mensagem_dono: env.LLM_ESFORCO_CONVERSA,
        relatorio_diario: env.LLM_ESFORCO,
        nota_processada: env.LLM_ESFORCO,
      },
    });
  };

  return executarRodada({
    casos,
    modo: op.modo,
    modelo: op.modo === "falso" ? NOME_MODELO_FALSO : env.LLM_MODELO,
    versaoPrompt: prompt.versao,
    comercianteId: dono.id,
    nomeComercio: dono.nome,
    dataReferencia: op.dataReferencia ?? mercadinho.hoje,
    registro: new RegistroExecucoesPostgres(op.db),
    criarAgente,
  });
}
