import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { ARMAZENAMENTO, ErroArmazenamento, type Armazenamento } from "../infra/armazenamento/armazenamento";
import { detectarTipo } from "../infra/armazenamento/tipo-arquivo";
import { DB, type Db } from "../infra/database/database.module";
import { compra, documento, fornecedor, itemDeCompra } from "../infra/database/schema";
import { FilaExtracao } from "./fila/fila-extracao";

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
  ) {}

  /** Guarda a foto, cria o documento (`pendente`) e enfileira a extração. */
  async receberNota(comercianteId: string, conteudo: Buffer): Promise<NotaRecebida> {
    const tipo = detectarTipo(conteudo);
    if (tipo !== "jpeg" && tipo !== "png") {
      throw new UnsupportedMediaTypeException("Envie a nota como foto JPEG ou PNG");
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
