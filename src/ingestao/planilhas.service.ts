import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ARMAZENAMENTO, ErroArmazenamento, type Armazenamento } from "../infra/armazenamento/armazenamento";
import { detectarTipo } from "../infra/armazenamento/tipo-arquivo";
import { DB, type Db } from "../infra/database/database.module";
import { documento, mapeamentoPlanilha, produto } from "../infra/database/schema";
import { gravarVendas } from "./planilha/importar-vendas";
import {
  interpretarLinhas,
  montarCatalogo,
  type CatalogoProdutos,
  type LinhaRejeitada,
} from "./planilha/interpretar-linhas";
import { ErroPlanilha, lerPlanilha, type PlanilhaLida } from "./planilha/leitor-planilha";
import {
  assinaturaDosCabecalhos,
  CAMPOS,
  sugerirMapeamento,
  validarMapeamento,
  type Campo,
  type Mapeamento,
} from "./planilha/mapeamento";

/** Quantas linhas rejeitadas vão na resposta e no documento; o total real vem à parte. */
const MAXIMO_REJEITADAS_LISTADAS = 200;
/** Parte do hash do arquivo que identifica a planilha nos cupons sintéticos. */
const ORIGEM_DO_CUPOM_CARACTERES = 12;

export const corpoConfirmacaoSchema = z.object({
  mapeamento: z
    .object(
      Object.fromEntries(CAMPOS.map((c) => [c, z.string().min(1).optional()])) as Record<
        Campo,
        z.ZodOptional<z.ZodString>
      >,
    )
    .strict(),
});

/** Como o dono fechou a revisão das linhas rejeitadas: fica no relatório, junto das linhas, sem apagá-las. */
export interface ResolucaoImportacao {
  decisao: "descartar";
  origem: "dono";
  em: string;
}

export const corpoResolucaoSchema = z.strictObject({ decisao: z.literal("descartar") });

export interface RelatorioImportacao {
  linhas_lidas: number;
  vendas_importadas: number;
  vendas_ja_existentes: number;
  itens_importados: number;
  total_rejeitadas: number;
  linhas_rejeitadas: LinhaRejeitada[];
  resolucao?: ResolucaoImportacao;
}

interface PendenteDeMapeamento {
  etapa: "aguardando_mapeamento";
  cabecalhos: string[];
  mapeamento_sugerido: Mapeamento;
  campos_faltando: Campo[];
}

export interface EstadoPlanilha {
  documento_id: string;
  status: string;
  duplicado: boolean;
  precisa_confirmar: boolean;
  cabecalhos?: string[];
  mapeamento_sugerido?: Mapeamento;
  campos_faltando?: Campo[];
  importacao?: RelatorioImportacao;
}

@Injectable()
export class PlanilhasService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ARMAZENAMENTO) private readonly armazenamento: Armazenamento,
  ) {}

  /**
   * Guarda a planilha e cria o documento. Se o formato (cabeçalhos) já tem um mapeamento confirmado
   * pelo dono, importa na hora; senão devolve a sugestão para ele confirmar uma única vez.
   */
  async receber(comercianteId: string, conteudo: Buffer): Promise<EstadoPlanilha> {
    const tipo = detectarTipo(conteudo);
    if (tipo !== "csv" && tipo !== "xlsx") {
      throw new UnsupportedMediaTypeException("Envie a planilha de vendas em CSV ou XLSX");
    }
    // Lê antes de guardar: planilha ilegível devolve 422 sem deixar arquivo órfão no armazenamento.
    const planilha = await this.ler(conteudo, tipo);
    let salvo;
    try {
      salvo = await this.armazenamento.salvar(comercianteId, conteudo);
    } catch (e) {
      if (e instanceof ErroArmazenamento) {
        if (e.motivo === "grande_demais") throw new PayloadTooLargeException(e.message);
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const [criado] = await this.db
      .insert(documento)
      .values({ comercianteId, tipo: "planilha", arquivoCaminho: salvo.caminho, arquivoHash: salvo.hash })
      .onConflictDoNothing({ target: [documento.comercianteId, documento.arquivoHash] })
      .returning();
    if (!criado) {
      const [existente] = await this.db
        .select()
        .from(documento)
        .where(and(eq(documento.comercianteId, comercianteId), eq(documento.arquivoHash, salvo.hash)))
        .limit(1);
      if (!existente) throw new Error("Documento não encontrado depois do conflito de hash");
      return estadoDe(existente, true);
    }

    const assinatura = assinaturaDosCabecalhos(planilha.cabecalhos);
    const [salvoMapeamento] = await this.db
      .select()
      .from(mapeamentoPlanilha)
      .where(
        and(
          eq(mapeamentoPlanilha.comercianteId, comercianteId),
          eq(mapeamentoPlanilha.assinatura, assinatura),
          eq(mapeamentoPlanilha.confirmadoPeloDono, true),
        ),
      )
      .limit(1);
    const reaproveitavel = salvoMapeamento?.mapeamento as Mapeamento | undefined;
    if (reaproveitavel && validarMapeamento(reaproveitavel, planilha.cabecalhos).length === 0) {
      return this.importar(comercianteId, criado.id, salvo.hash, planilha, reaproveitavel, false);
    }

    const { mapeamento, faltando } = sugerirMapeamento(planilha.cabecalhos);
    const pendente: PendenteDeMapeamento = {
      etapa: "aguardando_mapeamento",
      cabecalhos: planilha.cabecalhos,
      mapeamento_sugerido: mapeamento,
      campos_faltando: faltando,
    };
    await this.db
      .update(documento)
      .set({ extracaoJson: pendente })
      .where(and(eq(documento.id, criado.id), eq(documento.comercianteId, comercianteId)));
    return estadoDe({ ...criado, extracaoJson: pendente }, false);
  }

  /** O dono confirma (ou corrige) o mapeamento; fica salvo para as próximas planilhas do formato. */
  async confirmar(comercianteId: string, documentoId: string, corpo: unknown): Promise<EstadoPlanilha> {
    const [doc] = await this.db
      .select()
      .from(documento)
      .where(and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId)))
      .limit(1);
    if (!doc || doc.tipo !== "planilha") throw new NotFoundException("Planilha não encontrada");
    if (doc.statusExtracao !== "pendente") throw new ConflictException("Esta planilha já foi importada");

    const parsed = corpoConfirmacaoSchema.safeParse(corpo);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    const mapeamento: Mapeamento = parsed.data.mapeamento;
    const tipo = doc.arquivoCaminho.endsWith(".xlsx") ? "xlsx" : "csv";
    const planilha = await this.ler(await this.armazenamento.ler(doc.arquivoCaminho), tipo);

    const erros = validarMapeamento(mapeamento, planilha.cabecalhos);
    if (erros.length > 0) throw new BadRequestException(erros.map((e) => e.mensagem).join("; "));

    await this.db
      .insert(mapeamentoPlanilha)
      .values({
        comercianteId,
        assinatura: assinaturaDosCabecalhos(planilha.cabecalhos),
        mapeamento,
        confirmadoPeloDono: true,
      })
      .onConflictDoUpdate({
        target: [mapeamentoPlanilha.comercianteId, mapeamentoPlanilha.assinatura],
        set: { mapeamento, confirmadoPeloDono: true },
      });
    return this.importar(comercianteId, doc.id, doc.arquivoHash, planilha, mapeamento, false);
  }

  /**
   * O dono fecha a revisão de uma planilha com linhas rejeitadas: segue sem elas. O documento vai para
   * `extraido` e as vendas voltam à confiança que tinham (o teto de 0,5 só vale fora de `extraido`).
   * Nada é apagado (regra 10): o relatório com as linhas rejeitadas continua no documento, agora com a
   * resolução (decisão, origem e data). A troca é condicional ao status `revisao`, então duas chamadas
   * ao mesmo tempo resolvem uma vez só.
   */
  async resolver(comercianteId: string, documentoId: string, corpo: unknown): Promise<EstadoPlanilha> {
    const parsed = corpoResolucaoSchema.safeParse(corpo);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    const dono = and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId));
    const [doc] = await this.db.select().from(documento).where(dono).limit(1);
    if (!doc || doc.tipo !== "planilha") throw new NotFoundException("Planilha não encontrada");
    if (doc.statusExtracao !== "revisao") {
      throw new ConflictException("Só uma planilha em revisão pode ser resolvida");
    }
    const relatorio = doc.extracaoJson as RelatorioImportacao;
    const resolucao: ResolucaoImportacao = {
      decisao: parsed.data.decisao,
      origem: "dono",
      em: new Date().toISOString(),
    };
    const [atualizado] = await this.db
      .update(documento)
      .set({ statusExtracao: "extraido", extracaoJson: { ...relatorio, resolucao } })
      .where(and(dono, eq(documento.statusExtracao, "revisao")))
      .returning();
    if (!atualizado) throw new ConflictException("Só uma planilha em revisão pode ser resolvida");
    return estadoDe(atualizado, false);
  }

  private async ler(conteudo: Buffer, tipo: "csv" | "xlsx"): Promise<PlanilhaLida> {
    try {
      return await lerPlanilha(conteudo, tipo);
    } catch (e) {
      if (e instanceof ErroPlanilha) throw new UnprocessableEntityException(e.message);
      throw e;
    }
  }

  /**
   * Importa e fecha o documento. Se algo falhar no meio (banco fora do ar, por exemplo), o documento
   * volta a `pendente` com o mapeamento usado de volta na tela de confirmação: sem isso ficaria em
   * `processando` e o dono não conseguiria tentar de novo (reenviar devolve o estado, e confirmar
   * só aceita `pendente`).
   */
  private async importar(
    comercianteId: string,
    documentoId: string,
    arquivoHash: string,
    planilha: PlanilhaLida,
    mapeamento: Mapeamento,
    duplicado: boolean,
  ): Promise<EstadoPlanilha> {
    const dono = and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId));
    await this.db.update(documento).set({ statusExtracao: "processando" }).where(dono);
    try {
      return await this.importarLinhas(
        comercianteId,
        documentoId,
        arquivoHash,
        planilha,
        mapeamento,
        duplicado,
      );
    } catch (e) {
      const reaberto: PendenteDeMapeamento = {
        etapa: "aguardando_mapeamento",
        cabecalhos: planilha.cabecalhos,
        mapeamento_sugerido: mapeamento,
        campos_faltando: [],
      };
      // Melhor esforço: se nem isto gravar, o erro original é o que importa.
      await this.db
        .update(documento)
        .set({ statusExtracao: "pendente", extracaoJson: reaberto })
        .where(dono)
        .catch(() => undefined);
      throw e;
    }
  }

  private async importarLinhas(
    comercianteId: string,
    documentoId: string,
    arquivoHash: string,
    planilha: PlanilhaLida,
    mapeamento: Mapeamento,
    duplicado: boolean,
  ): Promise<EstadoPlanilha> {
    const dono = and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId));
    const catalogo = await this.carregarCatalogo(comercianteId);
    const { itens, rejeitadas } = interpretarLinhas(
      {
        cabecalhos: planilha.cabecalhos,
        linhas: planilha.linhas,
        mapeamento,
        // Cupom sintético por planilha: o mesmo arquivo repete os cupons, outro arquivo não colide.
        origem: arquivoHash.slice(0, ORIGEM_DO_CUPOM_CARACTERES),
      },
      catalogo,
    );
    const gravadas = await gravarVendas(this.db, { comercianteId, documentoId, itens });

    const relatorio: RelatorioImportacao = {
      linhas_lidas: planilha.linhas.length,
      vendas_importadas: gravadas.vendasNovas,
      vendas_ja_existentes: gravadas.vendasExistentes,
      itens_importados: gravadas.itensNovos,
      total_rejeitadas: rejeitadas.length,
      linhas_rejeitadas: rejeitadas.slice(0, MAXIMO_REJEITADAS_LISTADAS),
    };
    const [atualizado] = await this.db
      .update(documento)
      .set({
        // Linha rejeitada pede revisão do dono; sem rejeição a planilha está resolvida.
        statusExtracao: rejeitadas.length > 0 ? "revisao" : "extraido",
        confiancaMedia: planilha.linhas.length === 0 ? 1 : itens.length / planilha.linhas.length,
        extracaoJson: relatorio,
        processadoEm: new Date(),
      })
      .where(dono)
      .returning();
    if (!atualizado) throw new Error("Documento sumiu durante a importação");
    return estadoDe(atualizado, duplicado);
  }

  private async carregarCatalogo(comercianteId: string): Promise<CatalogoProdutos> {
    const produtos = await this.db
      .select({ id: produto.id, nome: produto.nome, codigoBarras: produto.codigoBarras })
      .from(produto)
      .where(eq(produto.comercianteId, comercianteId));
    return montarCatalogo(produtos);
  }
}

function estadoDe(doc: typeof documento.$inferSelect, duplicado: boolean): EstadoPlanilha {
  const base = { documento_id: doc.id, status: doc.statusExtracao, duplicado };
  const json = doc.extracaoJson as PendenteDeMapeamento | RelatorioImportacao | null;
  if (json && "etapa" in json) {
    return {
      ...base,
      precisa_confirmar: true,
      cabecalhos: json.cabecalhos,
      mapeamento_sugerido: json.mapeamento_sugerido,
      campos_faltando: json.campos_faltando,
    };
  }
  return { ...base, precisa_confirmar: false, ...(json ? { importacao: json } : {}) };
}
