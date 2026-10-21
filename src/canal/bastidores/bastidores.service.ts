import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, asc, or } from "drizzle-orm";
import type { BloqueioVerificador } from "../../agente/execucao/registro-execucoes";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { DB, type Db } from "../../infra/database/database.module";
import {
  chamadaFerramenta,
  compra,
  documento,
  execucaoAgente,
  fornecedor,
  itemDeCompra,
  produto,
} from "../../infra/database/schema";
import { FONTE_DECISOES_ALERTA, type FonteDecisoesAlerta } from "./fonte-decisoes-alerta";
import { abaixoDoLimite, agruparChamadas, versaoDoPainel } from "./montar-painel";
import type { ExecucaoBastidores, NotaBastidores, PainelBastidores } from "./tipos";

/** Só leitura. Toda consulta filtra por `comerciante_id` da sessão (regra inviolável 3). */
@Injectable()
export class BastidoresService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(FONTE_DECISOES_ALERTA) private readonly fonteAlertas: FonteDecisoesAlerta,
  ) {}

  async painel(comercianteId: string, limite: number): Promise<PainelBastidores> {
    const execucoes = await this.execucoesRecentes(comercianteId, limite);
    const ultimaNota = await this.ultimaNota(comercianteId);
    const desde = execucoes.at(-1)?.criada_em ?? new Date(0);
    const decisoes = await this.fonteAlertas.listar(comercianteId, {
      execucaoIds: execucoes.map((e) => e.id),
      desde,
    });
    const ids = new Set(execucoes.map((e) => e.id));
    for (const e of execucoes) {
      e.decisoes_alerta = decisoes.filter((d) => d.execucao_id === e.id);
    }
    return {
      versao: versaoDoPainel([
        execucoes[0]?.criada_em,
        ultimaNota?.processada_em ?? ultimaNota?.criada_em,
        ultimaNota?.criada_em,
      ]),
      execucoes,
      ultima_nota: ultimaNota,
      decisoes_sem_execucao: decisoes.filter((d) => !d.execucao_id || !ids.has(d.execucao_id)),
    };
  }

  /** As execuções mais novas primeiro, cada uma com as chamadas de ferramenta em ordem. */
  async execucoesRecentes(comercianteId: string, limite: number): Promise<ExecucaoBastidores[]> {
    const linhas = await this.db
      .select()
      .from(execucaoAgente)
      .where(eq(execucaoAgente.comercianteId, comercianteId))
      .orderBy(desc(execucaoAgente.criadoEm))
      .limit(limite);
    if (linhas.length === 0) return [];
    const chamadas = await this.db
      .select()
      .from(chamadaFerramenta)
      .where(
        and(
          eq(chamadaFerramenta.comercianteId, comercianteId),
          inArray(
            chamadaFerramenta.execucaoId,
            linhas.map((l) => l.id),
          ),
        ),
      )
      .orderBy(asc(chamadaFerramenta.execucaoId), asc(chamadaFerramenta.ordem));
    const porExecucao = agruparChamadas(chamadas);
    return linhas.map((l) => {
      const tentativas = l.detalhesVerificador as BloqueioVerificador[];
      return {
        id: l.id,
        gatilho: l.gatilho,
        criada_em: l.criadoEm,
        modelo: l.modelo,
        versao_prompt: l.versaoPrompt,
        resultado: l.resultado,
        iteracoes: l.iteracoes,
        entrada: l.entrada,
        mensagem_final: l.mensagemFinal,
        erro: l.erro,
        latencia_ms: l.latenciaMs,
        tokens: { entrada: l.tokensEntrada, saida: l.tokensSaida, cache_leitura: l.tokensCacheLeitura },
        custo_microdolares: l.custoEstimadoMicrodolares,
        verificador: { bloqueios: l.bloqueiosVerificador, tentativas },
        chamadas: (porExecucao.get(l.id) ?? []).map((c) => ({
          ordem: c.ordem,
          ferramenta: c.ferramenta,
          entrada: c.entrada,
          saida: c.saida,
          erro: c.erro,
          menor_confianca: c.menorConfianca,
          latencia_ms: c.latenciaMs,
        })),
        decisoes_alerta: [],
      };
    });
  }

  /** A nota mais recente (foto ou NF-e) com os itens e a confiança de cada um. */
  async ultimaNota(comercianteId: string): Promise<NotaBastidores | null> {
    const [doc] = await this.db
      .select()
      .from(documento)
      .where(
        and(
          eq(documento.comercianteId, comercianteId),
          or(eq(documento.tipo, "foto_nota"), eq(documento.tipo, "nfe")),
        ),
      )
      .orderBy(desc(documento.criadoEm))
      .limit(1);
    if (!doc) return null;

    const [cabecalho] = await this.db
      .select({
        id: compra.id,
        total: compra.totalCentavos,
        soma: compra.somaItensCentavos,
        fornecedorNome: fornecedor.nome,
        fornecedorCnpj: fornecedor.cnpj,
      })
      .from(compra)
      .innerJoin(
        fornecedor,
        and(eq(fornecedor.id, compra.fornecedorId), eq(fornecedor.comercianteId, compra.comercianteId)),
      )
      .where(and(eq(compra.comercianteId, comercianteId), eq(compra.documentoId, doc.id)))
      .limit(1);

    const itens = cabecalho
      ? await this.db
          .select({
            ordem: itemDeCompra.ordem,
            descricao: itemDeCompra.descricaoNota,
            quantidade: itemDeCompra.quantidade,
            unidade: itemDeCompra.unidade,
            unitario: itemDeCompra.valorUnitarioCentavos,
            total: itemDeCompra.valorTotalCentavos,
            confianca: itemDeCompra.confianca,
            revisao: itemDeCompra.revisaoPendente,
            produtoId: produto.id,
            produtoNome: produto.nome,
          })
          .from(itemDeCompra)
          .leftJoin(
            produto,
            and(
              eq(produto.id, itemDeCompra.produtoId),
              eq(produto.comercianteId, itemDeCompra.comercianteId),
            ),
          )
          .where(and(eq(itemDeCompra.comercianteId, comercianteId), eq(itemDeCompra.compraId, cabecalho.id)))
          .orderBy(asc(itemDeCompra.ordem))
      : [];

    const limite = this.env.LIMITE_CONFIANCA_ITEM;
    return {
      documento_id: doc.id,
      tipo: doc.tipo,
      status_extracao: doc.statusExtracao,
      confianca_media: doc.confiancaMedia,
      motivos_validacao: doc.motivosValidacao,
      erro: doc.erro,
      criada_em: doc.criadoEm,
      processada_em: doc.processadoEm,
      fornecedor: cabecalho ? { nome: cabecalho.fornecedorNome, cnpj: cabecalho.fornecedorCnpj } : null,
      total_centavos: cabecalho?.total ?? null,
      soma_itens_centavos: cabecalho?.soma ?? null,
      limite_confianca: limite,
      itens: itens.map((i) => ({
        ordem: i.ordem,
        descricao_nota: i.descricao,
        quantidade: i.quantidade,
        unidade: i.unidade,
        valor_unitario_centavos: i.unitario,
        valor_total_centavos: i.total,
        confianca: i.confianca,
        abaixo_do_limite: abaixoDoLimite(i.confianca, limite),
        revisao_pendente: i.revisao,
        produto: i.produtoId && i.produtoNome ? { id: i.produtoId, nome: i.produtoNome } : null,
      })),
    };
  }
}
