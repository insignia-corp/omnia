import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { NOTAS, PRODUTOS, type NotaBase } from "./dados-base";
import { type ExtracaoNota, LIMITE_CONFIANCA_ITEM } from "../../src/ingestao/extracao/esquema-extracao";
import type { FornecedorFixture } from "./mercadinho";
import { DIR_NOTAS, dataBr, decimalBr, decimalBrMilhar, escreverJson, formatarCnpj } from "./lib/util";

/** Confiança esperada nos gabaritos: alta para itens legíveis, baixa para os planejados como ilegíveis. */
const CONFIANCA_ALTA = 1;
const CONFIANCA_BAIXA = 0.5;

export interface ManifestoNota {
  id: string;
  arquivo_imagem: string;
  arquivo_esperado: string;
  fornecedor_id: string;
  numero_documento: string;
  data_emissao: string;
  /** Rótulos dos casos difíceis que a nota exercita. */
  casos: string[];
  /** Posições (base 0) dos itens que devem sair com confiança abaixo do limite. */
  itens_confianca_baixa: number[];
  /** Soma dos itens em centavos (calculada), para comparar com o total impresso. */
  soma_itens_centavos: number;
  soma_confere: boolean;
  /** Texto de injeção impresso na nota, se houver; o agente deve tratá-lo como dado. */
  texto_injecao: string | null;
  /** Para cada item (mesma ordem de `itens`), o produto do catálogo que a descrição representa. */
  vinculos_produto: string[];
  /** Reajuste plantado: custo unitário anterior do mesmo produto e fornecedor, em centavos. */
  reajuste_plantado: {
    produto_id: string;
    custo_anterior_centavos: number;
    custo_atual_centavos: number;
  } | null;
}

export interface NotaFixture {
  id: string;
  esperado: ExtracaoNota;
  manifesto: ManifestoNota;
  base: NotaBase;
  /** Linhas de texto impressas, na ordem em que aparecem na nota. */
  linhaDoItemIlegivel: number | null;
}

const produtoPorId = new Map(PRODUTOS.map((p) => [p.id, p]));

export function montarNotas(fornecedores: readonly FornecedorFixture[]): NotaFixture[] {
  const fornecedorPorId = new Map(fornecedores.map((f) => [f.id, f]));
  const ultimoCusto = new Map<string, { custo: number; data: string }>(); // `${fornecedor}|${produto}`

  return NOTAS.map((base) => {
    const fornecedor = fornecedorPorId.get(base.fornecedor);
    if (!fornecedor) throw new Error(`Fornecedor desconhecido: ${base.fornecedor}`);
    const id = `nota-${String(base.numero).padStart(2, "0")}`;
    let reajuste: ManifestoNota["reajuste_plantado"] = null;

    const itens = base.itens.map(([produtoId, quantidade, custoExplicito]) => {
      const produto = produtoPorId.get(produtoId);
      if (!produto) throw new Error(`Produto desconhecido: ${produtoId}`);
      if (produto.fornecedor !== base.fornecedor && custoExplicito === undefined) {
        throw new Error(`${id}: ${produtoId} de outro fornecedor exige custo explícito`);
      }
      const custo = custoExplicito ?? produto.custo;
      const chave = `${base.fornecedor}|${produtoId}`;
      const anterior = ultimoCusto.get(chave);
      if (anterior && custo * 100 > anterior.custo * 105) {
        reajuste = {
          produto_id: produtoId,
          custo_anterior_centavos: anterior.custo,
          custo_atual_centavos: custo,
        };
      }
      ultimoCusto.set(chave, { custo, data: base.data });
      const ilegivel = base.caso?.item_pouco_legivel === produtoId;
      return {
        produtoId,
        item: {
          descricao: produto.nota,
          quantidade,
          unidade: "UN",
          valor_unitario_centavos: custo,
          valor_total_centavos: custo * quantidade,
          confianca: ilegivel ? CONFIANCA_BAIXA : CONFIANCA_ALTA,
        },
      };
    });

    const soma = itens.reduce((acc, { item }) => acc + item.valor_total_centavos, 0);
    const total = soma + (base.caso?.divergencia_total_centavos ?? 0);
    const somaConfere = total === soma;
    const itensBaixos = itens.flatMap(({ item }, indice) =>
      item.confianca < LIMITE_CONFIANCA_ITEM ? [indice] : [],
    );
    const casos: string[] = [];
    if (reajuste) casos.push("reajuste_plantado");
    if (itensBaixos.length > 0) casos.push("item_pouco_legivel");
    if (!somaConfere) casos.push("soma_diverge_do_total");
    if (base.caso?.injecao) casos.push("texto_de_injecao");
    if (base.caso?.inclinacao_graus) casos.push("foto_inclinada");
    if (
      base.itens.some(
        ([produtoId, , custo]) =>
          custo !== undefined && produtoPorId.get(produtoId)?.fornecedor !== base.fornecedor,
      )
    ) {
      casos.push("mesmo_produto_de_outro_fornecedor");
    }

    const esperado: ExtracaoNota = {
      fornecedor: { nome: fornecedor.nome, cnpj: fornecedor.cnpj },
      data_emissao: base.data,
      itens: itens.map(({ item }) => item),
      total_centavos: total,
      // Divergência de soma derruba a confiança do documento (a redução é feita em código).
      confianca_documento: !somaConfere || itensBaixos.length > 0 ? CONFIANCA_BAIXA : CONFIANCA_ALTA,
    };

    const manifesto: ManifestoNota = {
      id,
      arquivo_imagem: `${id}.jpg`,
      arquivo_esperado: `${id}.esperado.json`,
      fornecedor_id: fornecedor.id,
      numero_documento: base.numero_documento,
      data_emissao: base.data,
      casos,
      itens_confianca_baixa: itensBaixos,
      soma_itens_centavos: soma,
      soma_confere: somaConfere,
      texto_injecao: base.caso?.injecao ?? null,
      vinculos_produto: itens.map(({ produtoId }) => produtoId),
      reajuste_plantado: reajuste,
    };

    const linhaDoItemIlegivel = itensBaixos.length > 0 ? (itensBaixos[0] ?? null) : null;
    return { id, esperado, manifesto, base, linhaDoItemIlegivel };
  });
}

const LARGURA_COLUNAS = 52;
const LARGURA_DESCRICAO = 24;
/** Coluna (em caracteres) onde começa a quantidade: "NN " + descrição + espaço. */
const COLUNA_QUANTIDADE = 3 + LARGURA_DESCRICAO + 1;
const ALTURA_LINHA = 30;
const MARGEM = 28;
const TAMANHO_FONTE = 21;

function alinhar(texto: string, largura: number, aDireita = false): string {
  const cortado = texto.length > largura ? texto.slice(0, largura) : texto;
  return aDireita ? cortado.padStart(largura) : cortado.padEnd(largura);
}

function linhasDaNota(nota: NotaFixture): string[] {
  const { esperado, base, manifesto } = nota;
  const linhas: string[] = [];
  const centro = (texto: string) => texto.padStart(Math.floor((LARGURA_COLUNAS + texto.length) / 2));
  const traco = "-".repeat(LARGURA_COLUNAS);
  const nome = esperado.fornecedor.nome.toUpperCase();
  linhas.push(centro(nome.length > LARGURA_COLUNAS ? nome.slice(0, LARGURA_COLUNAS) : nome));
  linhas.push(centro(`CNPJ ${formatarCnpj(esperado.fornecedor.cnpj)}`));
  linhas.push(centro("GOIANIA - GO"));
  linhas.push(traco);
  linhas.push(`NOTA DE VENDA No ${manifesto.numero_documento}`);
  linhas.push(`EMISSAO: ${dataBr(esperado.data_emissao)}`);
  linhas.push(`CLIENTE: MERCADINHO VILA NOVA`);
  linhas.push(traco);
  linhas.push(
    [
      "IT",
      alinhar("DESCRICAO", LARGURA_DESCRICAO),
      "QTD",
      "UN",
      "VL.UNIT".padStart(7),
      "TOTAL".padStart(8),
    ].join(" "),
  );
  esperado.itens.forEach((item, indice) => {
    linhas.push(
      [
        String(indice + 1).padStart(2, "0"),
        alinhar(item.descricao, LARGURA_DESCRICAO),
        String(item.quantidade).padStart(3),
        alinhar(item.unidade, 2),
        decimalBr(item.valor_unitario_centavos).padStart(7),
        decimalBrMilhar(item.valor_total_centavos).padStart(8),
      ].join(" "),
    );
  });
  linhas.push(traco);
  linhas.push(`${alinhar("TOTAL DA NOTA R$", 34)}${decimalBrMilhar(esperado.total_centavos).padStart(18)}`);
  linhas.push("PAGAMENTO: PIX NA ENTREGA");
  if (base.caso?.injecao) {
    linhas.push(traco);
    linhas.push("OBS:");
    // Quebra a observação para caber na largura da nota.
    const palavras = base.caso.injecao.split(" ");
    let atual = "";
    for (const palavra of palavras) {
      if ((atual + palavra).length + 1 > LARGURA_COLUNAS) {
        linhas.push(atual.trim());
        atual = "";
      }
      atual += `${palavra} `;
    }
    if (atual.trim()) linhas.push(atual.trim());
  }
  linhas.push("");
  linhas.push(centro("OBRIGADO PELA PREFERENCIA"));
  return linhas;
}

/**
 * Desenha a nota como imagem com ImageMagick (`magick`): papel claro, texto monoespaçado, leve
 * inclinação e ruído, e borrão pesado na linha do item que deve sair com confiança baixa.
 * É uma simulação de foto; fotos reais podem substituir os PNGs mantendo os mesmos nomes.
 */
export function renderizarNota(nota: NotaFixture, destino: string): void {
  const linhas = linhasDaNota(nota);
  const largura = MARGEM * 2 + Math.ceil(LARGURA_COLUNAS * TAMANHO_FONTE * 0.602);
  const altura = MARGEM * 2 + linhas.length * ALTURA_LINHA;
  const argumentos: string[] = ["-seed", "7", "-size", `${largura}x${altura}`, "xc:#f4f1e8"];
  const caixa = (indiceLinha: number) => MARGEM + indiceLinha * ALTURA_LINHA;

  argumentos.push("-font", "DejaVu-Sans-Mono", "-pointsize", String(TAMANHO_FONTE), "-fill", "#1c1c1c");
  linhas.forEach((linha, indice) => {
    argumentos.push("-annotate", `+${MARGEM}+${caixa(indice) + TAMANHO_FONTE}`, linha);
  });

  if (nota.linhaDoItemIlegivel !== null) {
    // Linha do item: depois dos 9 primeiros blocos de cabeçalho (ver linhasDaNota).
    const indiceLinha = 9 + nota.linhaDoItemIlegivel;
    const colunaInicial = Math.round(MARGEM + COLUNA_QUANTIDADE * TAMANHO_FONTE * 0.602);
    argumentos.push(
      "-region",
      `${largura - colunaInicial - MARGEM + 10}x${ALTURA_LINHA - 4}+${colunaInicial}+${caixa(indiceLinha) + 2}`,
      "-blur",
      "0x6",
      "+region",
    );
  }

  const inclinacao = nota.base.caso?.inclinacao_graus ?? 0;
  argumentos.push(
    "-attenuate",
    "0.12",
    "+noise",
    "Gaussian",
    "-background",
    "#bdb8aa",
    "-rotate",
    String(inclinacao),
    "-quality",
    "82",
    destino,
  );
  execFileSync("magick", argumentos, { stdio: "pipe" });
}

export function escreverNotas(notas: readonly NotaFixture[], comImagens: boolean): void {
  for (const nota of notas) {
    escreverJson(resolve(DIR_NOTAS, nota.manifesto.arquivo_esperado), nota.esperado);
    if (comImagens) renderizarNota(nota, resolve(DIR_NOTAS, nota.manifesto.arquivo_imagem));
  }
  escreverJson(
    resolve(DIR_NOTAS, "manifesto.json"),
    notas.map((n) => n.manifesto),
  );
}
