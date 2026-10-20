import { z } from "zod";
import {
  ErroClienteVisao,
  type ClienteVisao,
  type ConsumoExtracao,
  type ImagemNota,
  type PedidoVisao,
} from "./cliente-visao";
import { extracaoNotaSchema, type ExtracaoNota } from "./esquema-extracao";
import type { PromptExtrator } from "./prompt-extrator";

const ilegivelSchema = z.object({ erro: z.literal("ilegivel"), motivo: z.string() });
/** O que o modelo pode devolver: a nota ou o aviso de que não conseguiu ler. */
export const respostaModeloSchema = z.union([extracaoNotaSchema, ilegivelSchema]);

export type TipoFalhaExtracao = "json_invalido" | "ilegivel" | "recusa" | "erro_api";

interface Medidas {
  consumo: ConsumoExtracao;
  tentativas: number;
  latenciaMs: number;
  modelo: string;
  versaoPrompt: string;
}

export type ResultadoExtracao =
  | ({ ok: true; extracao: ExtracaoNota } & Medidas)
  | ({ ok: false; erro: TipoFalhaExtracao; mensagem: string } & Medidas);

/**
 * Extrator de notas (issue #24). Módulo isolado: não conhece banco, fila nem o resto da
 * aplicação. A saída do modelo só sai daqui depois de passar pelo esquema Zod (regra inviolável 5).
 *
 * - JSON inválido ou fora do esquema: uma nova tentativa com o erro do Zod; depois, `json_invalido`.
 * - Imagem ilegível, recusa ou erro não transitório: falha sem repetir.
 * - Erro transitório (timeout, 429, 5xx): a exceção sobe, para o job tentar de novo com espera.
 */
export class ExtratorNotas {
  constructor(
    private readonly cliente: ClienteVisao,
    private readonly prompt: PromptExtrator,
  ) {}

  async extrair(imagem: ImagemNota): Promise<ResultadoExtracao> {
    const inicio = Date.now();
    const consumo: ConsumoExtracao = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
    let tentativas = 0;
    let modelo = "";
    const medidas = (): Medidas => ({
      consumo,
      tentativas,
      latenciaMs: Date.now() - inicio,
      modelo,
      versaoPrompt: this.prompt.versao,
    });
    const falha = (erro: TipoFalhaExtracao, mensagem: string): ResultadoExtracao => ({
      ok: false,
      erro,
      mensagem,
      ...medidas(),
    });

    let correcao: PedidoVisao["correcao"];
    let ultimoErro = "";
    for (let t = 0; t < 2; t++) {
      tentativas++;
      let resposta;
      try {
        resposta = await this.cliente.extrair({
          sistema: this.prompt.texto,
          imagem,
          esquemaSaida: respostaModeloSchema,
          ...(correcao ? { correcao } : {}),
        });
      } catch (e) {
        if (e instanceof ErroClienteVisao && !e.transitorio) return falha("erro_api", e.message);
        throw e;
      }
      modelo = resposta.modelo;
      consumo.entrada += resposta.consumo.entrada;
      consumo.saida += resposta.consumo.saida;
      consumo.cacheLeitura += resposta.consumo.cacheLeitura;
      consumo.cacheEscrita += resposta.consumo.cacheEscrita;

      if (resposta.recusou) return falha("recusa", "O modelo recusou ler a imagem");

      const analise = analisar(resposta.texto);
      if (analise.tipo === "nota") return { ok: true, extracao: analise.extracao, ...medidas() };
      if (analise.tipo === "ilegivel") return falha("ilegivel", analise.motivo);
      ultimoErro = analise.erro;
      correcao = { respostaAnterior: resposta.texto, erros: analise.erro };
    }
    return falha("json_invalido", ultimoErro);
  }
}

type Analise =
  | { tipo: "nota"; extracao: ExtracaoNota }
  | { tipo: "ilegivel"; motivo: string }
  | { tipo: "invalida"; erro: string };

function analisar(texto: string): Analise {
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { tipo: "invalida", erro: "A resposta não é um JSON válido" };
  }
  // Valida direto contra o esquema da nota (e não contra a união) para o erro apontar o campo.
  const aviso = ilegivelSchema.safeParse(json);
  if (aviso.success) return { tipo: "ilegivel", motivo: aviso.data.motivo };
  const nota = extracaoNotaSchema.safeParse(json);
  if (!nota.success) {
    const erros = nota.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`);
    return { tipo: "invalida", erro: erros.join("; ") };
  }
  return { tipo: "nota", extracao: nota.data };
}
