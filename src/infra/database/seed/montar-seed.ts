import { LIMITE_CONFIANCA_ITEM } from "../../../ingestao/extracao/esquema-extracao";
import { montarPerguntaItem } from "../../../ingestao/revisao/perguntas";
import { normalizarDescricao } from "../../../ingestao/normalizar-descricao";
import type * as schema from "../schema";
import type { Fixtures } from "./carregar-fixtures";
import { uuidDeterministico } from "./uuid-deterministico";

type Linha<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/** Linhas prontas para inserir, de um comerciante, na ordem em que as tabelas dependem umas das outras. */
export interface LinhasSeed {
  comerciante: Linha<typeof schema.comerciante>;
  consentimentos: Linha<typeof schema.consentimento>[];
  conta: Linha<typeof schema.conta>;
  fornecedores: Linha<typeof schema.fornecedor>[];
  produtos: Linha<typeof schema.produto>[];
  documentos: Linha<typeof schema.documento>[];
  compras: Linha<typeof schema.compra>[];
  itensDeCompra: Linha<typeof schema.itemDeCompra>[];
  vinculos: Linha<typeof schema.vinculoDescricaoProduto>[];
  historicoCusto: Linha<typeof schema.historicoCusto>[];
  vendas: Linha<typeof schema.venda>[];
  itensDeVenda: Linha<typeof schema.itemDeVenda>[];
  transacoes: Linha<typeof schema.transacao>[];
  perguntas: Linha<typeof schema.perguntaDono>[];
}

export interface OpcoesComerciante {
  /** Chave estável: com ela os ids são sempre os mesmos. */
  chave: string;
  nome: string;
  telefoneWhatsapp: string;
  margemMetaBps: number;
}

/** Instante fixo para tudo que não tem data própria: o banco fica igual a cada execução do seed. */
export const INSTANTE_SEED = new Date("2026-10-19T23:00:00Z");
const VERSAO_TERMO = "2026-10-v1";

const meioDia = (data: string): Date => new Date(`${data}T12:00:00Z`);

/** Linhas de um comerciante a partir dos fixtures. Função pura: sem disco e sem banco. */
export function montarSeed(fix: Fixtures, opcoes: OpcoesComerciante): LinhasSeed {
  const id = (tipo: string, chave: string): string => uuidDeterministico(`${opcoes.chave}/${tipo}/${chave}`);
  const comercianteId = id("comerciante", "");
  const contaId = id("conta", "principal");

  const fornecedorId = (chave: string) => id("fornecedor", chave);
  const produtoId = (chave: string) => id("produto", chave);
  const nomeFornecedor = new Map(fix.fornecedores.map((f) => [f.id, f.nome]));
  const produtoPorBarras = new Map(fix.produtos.map((p) => [p.codigo_barras, p.id]));

  const fornecedores = fix.fornecedores.map((f) => ({
    id: fornecedorId(f.id),
    comercianteId,
    nome: f.nome,
    cnpj: f.cnpj,
    origem: "dono" as const,
    confianca: 1,
    criadoEm: INSTANTE_SEED,
  }));

  const produtos = fix.produtos.map((p) => ({
    id: produtoId(p.id),
    comercianteId,
    nome: p.nome,
    codigoBarras: p.codigo_barras,
    sku: p.id,
    unidade: p.unidade,
    categoria: p.categoria,
    origem: "planilha" as const,
    confianca: 1,
    criadoEm: INSTANTE_SEED,
  }));

  // Documentos: a planilha de vendas e cada nota.
  const documentoVendasId = id("documento", "vendas");
  const documentos: LinhasSeed["documentos"] = [
    {
      id: documentoVendasId,
      comercianteId,
      tipo: "planilha",
      arquivoCaminho: fix.arquivoVendas.caminho,
      arquivoHash: fix.arquivoVendas.hash,
      statusExtracao: "extraido",
      confiancaMedia: 1,
      criadoEm: INSTANTE_SEED,
      processadoEm: INSTANTE_SEED,
    },
  ];
  const compras: LinhasSeed["compras"] = [];
  const itensDeCompra: LinhasSeed["itensDeCompra"] = [];
  const historicoCusto: LinhasSeed["historicoCusto"] = [];
  const perguntas: LinhasSeed["perguntas"] = [];
  const vinculos: LinhasSeed["vinculos"] = [];
  const vinculoVisto = new Set<string>();

  const notasEmOrdem = [...fix.notas].sort(
    (a, b) => a.dataEmissao.localeCompare(b.dataEmissao) || a.id.localeCompare(b.id),
  );
  for (const nota of notasEmOrdem) {
    const criadoEm = meioDia(nota.dataEmissao);
    const origem = nota.formato;
    const revisao = !nota.somaConfere || nota.itensConfiancaBaixa.length > 0;
    const documentoId = id("documento", nota.id);
    documentos.push({
      id: documentoId,
      comercianteId,
      tipo: nota.formato,
      arquivoCaminho: nota.arquivo,
      arquivoHash: nota.hashArquivo,
      statusExtracao: revisao ? "revisao" : "extraido",
      confiancaMedia: nota.extracao.confianca_documento,
      extracaoJson: nota.extracao,
      criadoEm,
      processadoEm: criadoEm,
    });
    const compraId = id("compra", nota.id);
    compras.push({
      id: compraId,
      comercianteId,
      documentoId,
      fornecedorId: fornecedorId(nota.fornecedorId),
      data: nota.dataEmissao,
      numeroDocumento: nota.numeroDocumento,
      totalCentavos: nota.extracao.total_centavos,
      somaItensCentavos: nota.somaItensCentavos,
      origem,
      confianca: nota.extracao.confianca_documento,
      criadoEm,
    });

    nota.extracao.itens.forEach((item, indice) => {
      const produtoFixtureId = nota.produtoPorItem[indice];
      if (!produtoFixtureId) throw new Error(`${nota.id}: item ${indice + 1} sem produto`);
      const itemId = id("item_de_compra", `${nota.id}/${indice}`);
      const baixa = item.confianca < LIMITE_CONFIANCA_ITEM;
      itensDeCompra.push({
        id: itemId,
        comercianteId,
        compraId,
        produtoId: produtoId(produtoFixtureId),
        ordem: indice + 1,
        descricaoNota: item.descricao,
        quantidade: item.quantidade,
        unidade: item.unidade,
        valorUnitarioCentavos: item.valor_unitario_centavos,
        valorTotalCentavos: item.valor_total_centavos,
        confianca: item.confianca,
        origem,
        revisaoPendente: baixa,
        criadoEm,
      });
      historicoCusto.push({
        id: id("historico_custo", itemId),
        comercianteId,
        produtoId: produtoId(produtoFixtureId),
        fornecedorId: fornecedorId(nota.fornecedorId),
        data: nota.dataEmissao,
        custoUnitarioCentavos: item.valor_unitario_centavos,
        itemDeCompraId: itemId,
        origem,
        confianca: item.confianca,
        criadoEm,
      });

      const descricao = normalizarDescricao(item.descricao);
      const chaveVinculo = `${nota.fornecedorId}|${descricao}`;
      if (!vinculoVisto.has(chaveVinculo)) {
        vinculoVisto.add(chaveVinculo);
        vinculos.push({
          id: id("vinculo", chaveVinculo),
          comercianteId,
          fornecedorId: fornecedorId(nota.fornecedorId),
          descricaoNormalizada: descricao,
          produtoId: produtoId(produtoFixtureId),
          // Item duvidoso: a sugestão é do modelo e o dono ainda não confirmou.
          metodo: baixa ? "modelo" : "dono",
          confianca: item.confianca,
          confirmadoPeloDono: !baixa,
          confirmadoEm: baixa ? null : criadoEm,
          criadoEm,
        });
      }

      if (baixa) {
        perguntas.push({
          id: id("pergunta", itemId),
          comercianteId,
          tipo: "confirmar_item",
          status: "pendente",
          pergunta: montarPerguntaItem({
            descricao: item.descricao,
            data: nota.dataEmissao,
            fornecedor: nomeFornecedor.get(nota.fornecedorId) ?? nota.fornecedorId,
            valorUnitarioCentavos: item.valor_unitario_centavos,
          }),
          contexto: { nota: nota.id, ordem: indice + 1, confianca: item.confianca },
          itemDeCompraId: itemId,
          criadoEm,
        });
      }
    });
  }

  // Vendas: um cupom por venda, itens ligados ao produto pelo código de barras.
  const vendas: LinhasSeed["vendas"] = [];
  const itensDeVenda: LinhasSeed["itensDeVenda"] = [];
  for (const cupom of fix.cupons) {
    const vendaId = id("venda", `${cupom.data}/${cupom.numero}`);
    vendas.push({
      id: vendaId,
      comercianteId,
      documentoId: documentoVendasId,
      data: cupom.data,
      hora: cupom.hora,
      numeroCupom: cupom.numero,
      totalCentavos: cupom.itens.reduce((soma, i) => soma + i.totalCentavos, 0),
      origem: "planilha",
      confianca: 1,
      criadoEm: INSTANTE_SEED,
    });
    cupom.itens.forEach((item, indice) => {
      const produtoFixtureId = produtoPorBarras.get(item.codigoBarras);
      if (!produtoFixtureId) throw new Error(`Cupom ${cupom.numero}: código de barras desconhecido`);
      itensDeVenda.push({
        id: id("item_de_venda", `${vendaId}/${indice}`),
        comercianteId,
        vendaId,
        produtoId: produtoId(produtoFixtureId),
        quantidade: item.quantidade,
        precoUnitarioCentavos: item.precoUnitarioCentavos,
        valorTotalCentavos: item.totalCentavos,
      });
    });
  }

  const primeiraData = fix.transacoes.map((t) => t.data).sort()[0] ?? "";
  const transacoes = fix.transacoes
    .filter((t) => t.valorCentavos > 0)
    .map((t) => ({
      id: id("transacao", t.id),
      comercianteId,
      contaId,
      data: t.data,
      valorCentavos: t.valorCentavos,
      tipo: t.tipo,
      descricao: t.descricao,
      categoria: t.categoria,
      idExterno: t.id,
      origem: "banco" as const,
      confianca: 1,
      criadoEm: INSTANTE_SEED,
    }));

  return {
    comerciante: {
      id: comercianteId,
      nome: opcoes.nome,
      telefoneWhatsapp: opcoes.telefoneWhatsapp,
      tipoComercio: fix.perfil.tipo_comercio,
      margemMetaBps: opcoes.margemMetaBps,
      criadoEm: INSTANTE_SEED,
    },
    consentimentos: (["banco", "notas"] as const).map((tipo) => ({
      id: id("consentimento", tipo),
      comercianteId,
      tipo,
      versaoTermo: VERSAO_TERMO,
      concedidoEm: INSTANTE_SEED,
    })),
    conta: {
      id: contaId,
      comercianteId,
      instituicao: "Banco Sandbox",
      conexaoId: `sandbox-${opcoes.chave}`,
      tipo: "corrente",
      status: "ativo",
      saldoInicialCentavos: fix.perfil.saldo_inicial_conta_centavos,
      saldoInicialEm: primeiraData,
      // A conta de demonstração foi importada até o último dia do extrato de teste.
      ultimaSincronizacaoEm:
        fix.transacoes
          .map((t) => t.data)
          .sort()
          .at(-1) ?? null,
      criadoEm: INSTANTE_SEED,
    },
    fornecedores,
    produtos,
    documentos,
    compras,
    itensDeCompra,
    vinculos,
    historicoCusto,
    vendas,
    itensDeVenda,
    transacoes,
    perguntas,
  };
}

/**
 * Recorte menor dos mesmos fixtures para o segundo comerciante, que existe para provar o
 * isolamento: poucos produtos, as últimas semanas de vendas e só as notas e transações que ficam
 * inteiras dentro do recorte.
 */
export function recortar(fix: Fixtures, opcoes: { produtos: number; ultimosDias: number }): Fixtures {
  const produtos = fix.produtos.slice(0, opcoes.produtos);
  const ids = new Set(produtos.map((p) => p.id));
  const barras = new Set(produtos.map((p) => p.codigo_barras));
  const ultimaData =
    fix.cupons
      .map((c) => c.data)
      .sort()
      .at(-1) ?? "";
  const corte = new Date(Date.parse(`${ultimaData}T00:00:00Z`) - (opcoes.ultimosDias - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const notas = fix.notas.filter((n) => n.dataEmissao >= corte && n.produtoPorItem.every((p) => ids.has(p)));
  const fornecedoresUsados = new Set([
    ...produtos.map((p) => p.fornecedor_principal_id),
    ...notas.map((n) => n.fornecedorId),
  ]);
  return {
    ...fix,
    perfil: { ...fix.perfil, saldo_inicial_conta_centavos: 800_000 },
    fornecedores: fix.fornecedores.filter((f) => fornecedoresUsados.has(f.id)),
    produtos,
    cupons: fix.cupons
      .filter((c) => c.data >= corte)
      .map((c) => ({ ...c, itens: c.itens.filter((i) => barras.has(i.codigoBarras)) }))
      .filter((c) => c.itens.length > 0),
    arquivoVendas: { ...fix.arquivoVendas, hash: `${fix.arquivoVendas.hash}-recorte` },
    notas,
    transacoes: fix.transacoes.filter((t) => t.data >= corte),
  };
}
