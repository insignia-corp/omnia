import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { ARMAZENAMENTO, ErroArmazenamento, type Armazenamento } from "../infra/armazenamento/armazenamento";
import { detectarTipo } from "../infra/armazenamento/tipo-arquivo";
import { DB, type Db } from "../infra/database/database.module";
import { compra, documento, fornecedor, itemDeCompra } from "../infra/database/schema";
import { FilaExtracao } from "./fila/fila-extracao";
import { importarNfe } from "./nfe/importar-nfe";
import { lerNfe } from "./nfe/ler-nfe";

export interface NotaRecebida {
  documentoId: string;
  status: string;
  /** Verdadeiro quando o mesmo arquivo já tinha sido enviado por este comerciante. */
  duplicado: boolean;
}

@Injectable()
export class DocumentosService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ARMAZENAMENTO) private readonly armazenamento: Armazenamento,
    private readonly fila: FilaExtracao,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Foto: guarda, cria o documento (`pendente`) e enfileira a extração pelo modelo. XML de NF-e: lê
   * em código e grava na hora, sem fila e sem modelo.
   */
  async receberNota(comercianteId: string, conteudo: Buffer): Promise<NotaRecebida> {
    const tipo = detectarTipo(conteudo);
    if (tipo === "xml") return this.receberNfe(comercianteId, conteudo);
    if (tipo !== "jpeg" && tipo !== "png") {
      throw new UnsupportedMediaTypeException("Envie a nota como foto JPEG ou PNG, ou o XML da NF-e");
    }
    let salvo;
    try {
      salvo = await this.armazenamento.salvar(comercianteId, conteudo);
    } catch (e) {
      if (e instanceof ErroArmazenamento) {
        if (e.motivo === "grande_demais") throw new PayloadTooLargeException(e.message);
        if (e.motivo === "tipo_nao_aceito") throw new UnsupportedMediaTypeException(e.message);
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const [criado] = await this.db
      .insert(documento)
      .values({ comercianteId, tipo: "foto_nota", arquivoCaminho: salvo.caminho, arquivoHash: salvo.hash })
      .onConflictDoNothing({ target: [documento.comercianteId, documento.arquivoHash] })
      .returning({ id: documento.id, status: documento.statusExtracao });
    if (criado) {
      await this.fila.enfileirar({ documentoId: criado.id, comercianteId });
      return { documentoId: criado.id, status: criado.status, duplicado: false };
    }

    const [existente] = await this.db
      .select({ id: documento.id, status: documento.statusExtracao })
      .from(documento)
      .where(and(eq(documento.comercianteId, comercianteId), eq(documento.arquivoHash, salvo.hash)))
      .limit(1);
    if (!existente) throw new Error("Documento não encontrado depois do conflito de hash");
    // Envio anterior que não chegou à fila: o jobId do documento impede duplicar quando já está lá.
    if (existente.status === "pendente") {
      await this.fila.enfileirar({ documentoId: existente.id, comercianteId });
    }
    return { documentoId: existente.id, status: existente.status, duplicado: true };
  }

  /** O XML é lido antes de guardar: o que não é NF-e válida não deixa rastro. */
  private async receberNfe(comercianteId: string, conteudo: Buffer): Promise<NotaRecebida> {
    const leitura = lerNfe(conteudo);
    if (!leitura.ok) throw new UnprocessableEntityException(leitura.mensagem);
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
      .values({ comercianteId, tipo: "nfe", arquivoCaminho: salvo.caminho, arquivoHash: salvo.hash })
      .onConflictDoNothing({ target: [documento.comercianteId, documento.arquivoHash] })
      .returning({ id: documento.id });
    const [doc] = criado
      ? [criado]
      : await this.db
          .select({ id: documento.id })
          .from(documento)
          .where(and(eq(documento.comercianteId, comercianteId), eq(documento.arquivoHash, salvo.hash)))
          .limit(1);
    if (!doc) throw new Error("Documento não encontrado depois do conflito de hash");

    // `gravarCompra` é idempotente por documento: reenviar o arquivo, ou retomar um envio que caiu
    // entre o insert e a gravação, não duplica a compra.
    await importarNfe(this.db, {
      comercianteId,
      documentoId: doc.id,
      leitura,
      hoje: new Date().toISOString().slice(0, 10),
      limiteConfiancaItem: this.env.LIMITE_CONFIANCA_ITEM,
      limiteSimilaridade: this.env.LIMITE_SIMILARIDADE,
    });
    const [atual] = await this.db
      .select({ status: documento.statusExtracao })
      .from(documento)
      .where(and(eq(documento.id, doc.id), eq(documento.comercianteId, comercianteId)))
      .limit(1);
    return { documentoId: doc.id, status: atual?.status ?? "extraido", duplicado: !criado };
  }

  /** Estado do documento, com a compra e os itens quando a extração terminou. */
  async obter(comercianteId: string, documentoId: string) {
    const dono = and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId));
    const [doc] = await this.db.select().from(documento).where(dono).limit(1);
    if (!doc) throw new NotFoundException("Documento não encontrado");

    const [c] = await this.db
      .select({
        id: compra.id,
        data: compra.data,
        total: compra.totalCentavos,
        soma: compra.somaItensCentavos,
        confianca: compra.confianca,
        fornecedorNome: fornecedor.nome,
        fornecedorCnpj: fornecedor.cnpj,
      })
      .from(compra)
      .innerJoin(
        fornecedor,
        and(eq(fornecedor.id, compra.fornecedorId), eq(fornecedor.comercianteId, compra.comercianteId)),
      )
      .where(and(eq(compra.comercianteId, comercianteId), eq(compra.documentoId, documentoId)))
      .limit(1);
    const itens = c
      ? await this.db
          .select()
          .from(itemDeCompra)
          .where(and(eq(itemDeCompra.comercianteId, comercianteId), eq(itemDeCompra.compraId, c.id)))
          .orderBy(asc(itemDeCompra.ordem))
      : [];

    return {
      id: doc.id,
      tipo: doc.tipo,
      status: doc.statusExtracao,
      confianca_media: doc.confiancaMedia,
      motivos: doc.motivosValidacao,
      erro: doc.erro,
      // Relatório da importação (linhas lidas, rejeitadas...); nas fotos o JSON é a própria nota.
      importacao: doc.tipo === "planilha" ? doc.extracaoJson : null,
      processado_em: doc.processadoEm,
      compra: c
        ? {
            id: c.id,
            data: c.data,
            fornecedor: { nome: c.fornecedorNome, cnpj: c.fornecedorCnpj },
            total_centavos: c.total,
            soma_itens_centavos: c.soma,
            confianca: c.confianca,
            itens: itens.map((i) => ({
              id: i.id,
              ordem: i.ordem,
              descricao: i.descricaoNota,
              quantidade: i.quantidade,
              unidade: i.unidade,
              valor_unitario_centavos: i.valorUnitarioCentavos,
              valor_total_centavos: i.valorTotalCentavos,
              confianca: i.confianca,
              origem: i.origem,
              revisao_pendente: i.revisaoPendente,
            })),
          }
        : null,
    };
  }
}
