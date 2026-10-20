/**
 * Gabarito de métricas e alertas (issue #16). Calculado à parte: lê só os arquivos já gerados em
 * `fixtures/` (vendas.csv, extrato.csv, notas, catálogo), sem usar as estruturas dos geradores nem
 * `src/metricas`. As definições de cada métrica estão em `parametros` e seguem o guia.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_REFERENCIA, INICIO_JANELA } from "./dados-base";
import type { ManifestoNota } from "./notas";
import type { ExtracaoNota } from "../../src/ingestao/extracao/esquema-extracao";
import type { FornecedorFixture, ProdutoFixture } from "./mercadinho";
import {
  DIR_GABARITO,
  DIR_MERCADINHO,
  DIR_NOTAS,
  diasEntre,
  escreverJson,
  intervaloDeDatas,
  mediana,
  somarDias,
} from "./lib/util";

export const PARAMETROS = {
  data_referencia: DATA_REFERENCIA,
  janela_dados: { inicio: INICIO_JANELA, fim: DATA_REFERENCIA },
  margem: {
    formula: "(preco_medio_venda - custo_compra_mais_recente) / preco_medio_venda",
    janela_preco_dias: 30,
    preco_medio: "receita / quantidade dos últimos 30 dias, arredondado em centavos",
    custo: "custo unitário da nota mais recente do produto, de qualquer fornecedor",
    unidade: "margem_bps em pontos-base (2500 = 25,00%)",
  },
  variacao_custo: {
    formula:
      "(custo da compra atual - custo da compra anterior do mesmo produto e fornecedor) / custo anterior",
    limite_bps: 500,
    alerta_se: "variacao_bps > limite_bps e a compra atual tem no máximo 7 dias na data de referência",
    janela_alerta_dias: 7,
  },
  giro: {
    formula: "unidades dos últimos 7 dias / média semanal das unidades dos 28 dias anteriores",
    ultimos_dias: 7,
    anteriores_dias: 28,
    alta_bps: "(4 * unidades_7d - unidades_28d) / unidades_28d, em pontos-base",
    minimo_media_semanal: 14,
    top_n: 5,
    giro_alto: "entre os 5 de maior alta (com média semanal mínima) ou entre os 5 de maior volume em 7 dias",
  },
  espaco_subir_preco: "giro_alto e margem_bps abaixo da meta, ao mesmo tempo",
  estoque_parado: {
    limite_dias: 30,
    regra: "produto com compra e mais de 30 dias sem venda na data de referência",
  },
  ticket_medio: {
    formula: "faturamento do dia / número de cupons do dia",
    base: "média ponderada dos 28 dias anteriores (faturamento total / cupons totais)",
    limite_queda_bps: 3000,
  },
  gasto_fora_do_padrao: {
    formula: "(valor do dia - mediana dos 60 dias anteriores) / desvio absoluto mediano",
    serie: "saídas da categoria despesa_operacional somadas por dia",
    janela_dias: 60,
    minimo_dias_de_historico: 30,
    limite_desvio: 3,
    nota: "compras de mercadoria e despesas fixas ficam fora da série: variam por natureza",
  },
} as const;

const JANELA_PRECO = PARAMETROS.margem.janela_preco_dias;
const LIMITE_VARIACAO_BPS = PARAMETROS.variacao_custo.limite_bps;
const LIMITE_ESTOQUE_PARADO = PARAMETROS.estoque_parado.limite_dias;
const LIMITE_QUEDA_TICKET_BPS = PARAMETROS.ticket_medio.limite_queda_bps;
const LIMITE_DESVIO = PARAMETROS.gasto_fora_do_padrao.limite_desvio;

interface Venda {
  data: string;
  cupom: number;
  produtoId: string;
  quantidade: number;
  precoUnitario: number;
}
interface Transacao {
  data: string;
  valor: number;
  tipo: string;
  categoria: string;
}
interface Compra {
  nota: string;
  data: string;
  fornecedorId: string;
  produtoId: string;
  custo: number;
  confianca: number;
}

const lerJson = <T>(caminho: string): T => JSON.parse(readFileSync(caminho, "utf8")) as T;
const centavosDeTexto = (texto: string): number => {
  const [reais = "0", centavos = "0"] = texto.split(",");
  return Number(reais) * 100 + Number(centavos.padEnd(2, "0"));
};
const bps = (numerador: number, denominador: number): number =>
  Math.round((numerador * 10_000) / denominador);
const percentual = (valorBps: number): number => valorBps / 100;

function lerVendas(catalogo: readonly ProdutoFixture[]): Venda[] {
  const idPorCodigo = new Map(catalogo.map((c) => [c.codigo_barras, c.id]));
  const [, ...linhas] = readFileSync(resolve(DIR_MERCADINHO, "vendas.csv"), "utf8").trim().split("\n");
  return linhas.map((linha) => {
    const [data = "", , cupom = "", codigo = "", , quantidade = "", preco = ""] = linha.split(";");
    const [dia, mes, ano] = data.split("/");
    return {
      data: `${ano}-${mes}-${dia}`,
      cupom: Number(cupom),
      produtoId: idPorCodigo.get(codigo) ?? `?${codigo}`,
      quantidade: Number(quantidade),
      precoUnitario: centavosDeTexto(preco),
    };
  });
}

function lerExtrato(): Transacao[] {
  const [, ...linhas] = readFileSync(resolve(DIR_MERCADINHO, "extrato.csv"), "utf8").trim().split("\n");
  return linhas.map((linha) => {
    const [, data = "", , valor = "", tipo = "", categoria = ""] = linha.split(";");
    return { data, valor: Number(valor), tipo, categoria };
  });
}

function lerCompras(): Compra[] {
  const manifesto = lerJson<ManifestoNota[]>(resolve(DIR_NOTAS, "manifesto.json"));
  return manifesto.flatMap((m) => {
    const esperado = lerJson<ExtracaoNota>(resolve(DIR_NOTAS, m.arquivo_esperado));
    return esperado.itens.map((item, indice) => ({
      nota: m.id,
      data: m.data_emissao,
      fornecedorId: m.fornecedor_id,
      produtoId: m.vinculos_produto[indice] ?? "?",
      custo: item.valor_unitario_centavos,
      confianca: Math.min(item.confianca, esperado.confianca_documento),
    }));
  });
}

function afirmar(condicao: boolean, mensagem: string): void {
  if (!condicao) throw new Error(`Gabarito inconsistente com o plano de dados: ${mensagem}`);
}

export function gerarGabarito(): void {
  const catalogo = lerJson<ProdutoFixture[]>(resolve(DIR_MERCADINHO, "catalogo.json"));
  const fornecedores = lerJson<FornecedorFixture[]>(resolve(DIR_MERCADINHO, "fornecedores.json"));
  const perfil = lerJson<{ margem_meta_bps: number; saldo_inicial_conta_centavos: number }>(
    resolve(DIR_MERCADINHO, "perfil.json"),
  );
  const vendas = lerVendas(catalogo);
  const extrato = lerExtrato();
  const compras = lerCompras();
  const ref = DATA_REFERENCIA;
  const nomeDoProduto = new Map(catalogo.map((c) => [c.id, c.nome]));
  const meta = perfil.margem_meta_bps;
  afirmar(
    vendas.every((v) => !v.produtoId.startsWith("?")),
    "venda com código de barras fora do catálogo",
  );

  // Agregados diários.
  const faturamentoPorDia = new Map<string, number>();
  const cuponsPorDia = new Map<string, Set<number>>();
  const unidadesPorProdutoDia = new Map<string, Map<string, number>>();
  const ultimaVenda = new Map<string, string>();
  for (const v of vendas) {
    faturamentoPorDia.set(v.data, (faturamentoPorDia.get(v.data) ?? 0) + v.precoUnitario * v.quantidade);
    cuponsPorDia.set(v.data, (cuponsPorDia.get(v.data) ?? new Set()).add(v.cupom));
    const porDia = unidadesPorProdutoDia.get(v.produtoId) ?? new Map<string, number>();
    porDia.set(v.data, (porDia.get(v.data) ?? 0) + v.quantidade);
    unidadesPorProdutoDia.set(v.produtoId, porDia);
    if ((ultimaVenda.get(v.produtoId) ?? "") < v.data) ultimaVenda.set(v.produtoId, v.data);
  }
  const dias = intervaloDeDatas(INICIO_JANELA, ref);
  const unidadesNaJanela = (produtoId: string, inicio: string, fim: string): number =>
    [...(unidadesPorProdutoDia.get(produtoId) ?? [])].reduce(
      (soma, [data, unidades]) => (data >= inicio && data <= fim ? soma + unidades : soma),
      0,
    );

  // Custo mais recente por produto.
  const ultimaCompra = new Map<string, Compra>();
  for (const c of compras) {
    const atual = ultimaCompra.get(c.produtoId);
    if (!atual || c.data > atual.data) ultimaCompra.set(c.produtoId, c);
  }

  // Margem por produto.
  const inicioPreco = somarDias(ref, -(JANELA_PRECO - 1));
  const margens = catalogo.map((produto) => {
    let receita = 0;
    let quantidade = 0;
    for (const v of vendas) {
      if (v.produtoId === produto.id && v.data >= inicioPreco) {
        receita += v.precoUnitario * v.quantidade;
        quantidade += v.quantidade;
      }
    }
    const compra = ultimaCompra.get(produto.id);
    const preco = quantidade > 0 ? Math.round(receita / quantidade) : null;
    const margemBps = preco !== null && compra ? bps(preco - compra.custo, preco) : null;
    const situacao = !compra ? "sem_custo" : preco === null ? "sem_venda_na_janela" : "ok";
    return {
      produto_id: produto.id,
      nome: produto.nome,
      situacao,
      preco_medio_venda_centavos: preco,
      custo_compra_mais_recente_centavos: compra?.custo ?? null,
      compra_data: compra?.data ?? null,
      compra_nota: compra?.nota ?? null,
      fornecedor_id: compra?.fornecedorId ?? null,
      margem_bps: margemBps,
      margem_percentual: margemBps === null ? null : percentual(margemBps),
      abaixo_da_meta: margemBps === null ? null : margemBps < meta,
      n_registros: quantidade,
      menor_confianca: compra?.confianca ?? null,
    };
  });
  const margemAbaixoDaMeta = margens.filter((m) => m.abaixo_da_meta === true);

  // Variação de custo: pares produto x fornecedor com pelo menos duas compras.
  const grupos = new Map<string, Compra[]>();
  for (const c of compras)
    grupos.set(`${c.fornecedorId}|${c.produtoId}`, [
      ...(grupos.get(`${c.fornecedorId}|${c.produtoId}`) ?? []),
      c,
    ]);
  const variacoes = [...grupos.values()]
    .filter((lista) => lista.length >= 2)
    .map((lista) => {
      const ordenada = [...lista].sort((a, b) => a.data.localeCompare(b.data));
      const atual = ordenada[ordenada.length - 1] as Compra;
      const anterior = ordenada[ordenada.length - 2] as Compra;
      const variacaoBps = bps(atual.custo - anterior.custo, anterior.custo);
      const recente = diasEntre(atual.data, ref) <= PARAMETROS.variacao_custo.janela_alerta_dias;
      return {
        produto_id: atual.produtoId,
        nome: nomeDoProduto.get(atual.produtoId) ?? "",
        fornecedor_id: atual.fornecedorId,
        custo_anterior_centavos: anterior.custo,
        custo_atual_centavos: atual.custo,
        compra_anterior: { nota: anterior.nota, data: anterior.data },
        compra_atual: { nota: atual.nota, data: atual.data },
        variacao_bps: variacaoBps,
        variacao_percentual: percentual(variacaoBps),
        acima_do_limite: variacaoBps > LIMITE_VARIACAO_BPS,
        dispara_alerta: variacaoBps > LIMITE_VARIACAO_BPS && recente,
        menor_confianca: Math.min(atual.confianca, anterior.confianca),
      };
    })
    .filter((v) => v.variacao_bps !== 0)
    .sort((a, b) => b.variacao_bps - a.variacao_bps);

  // Giro.
  const inicio7 = somarDias(ref, -6);
  const inicio28 = somarDias(ref, -34);
  const fim28 = somarDias(ref, -7);
  const giro = catalogo
    .map((produto) => {
      const u7 = unidadesNaJanela(produto.id, inicio7, ref);
      const u28 = unidadesNaJanela(produto.id, inicio28, fim28);
      return {
        produto_id: produto.id,
        nome: produto.nome,
        unidades_7_dias: u7,
        unidades_28_dias_anteriores: u28,
        media_semanal_28_dias: u28 / 4,
        alta_bps: u28 > 0 ? bps(4 * u7 - u28, u28) : null,
        elegivel_para_alta: u28 / 4 >= PARAMETROS.giro.minimo_media_semanal,
      };
    })
    .sort((a, b) => a.produto_id.localeCompare(b.produto_id));
  const topAlta = giro
    .filter((g) => g.elegivel_para_alta && g.alta_bps !== null)
    .sort((a, b) => (b.alta_bps ?? 0) - (a.alta_bps ?? 0) || a.produto_id.localeCompare(b.produto_id))
    .slice(0, PARAMETROS.giro.top_n);
  const topVolume = [...giro]
    .sort((a, b) => b.unidades_7_dias - a.unidades_7_dias || a.produto_id.localeCompare(b.produto_id))
    .slice(0, PARAMETROS.giro.top_n);
  const giroAlto = new Set([...topAlta, ...topVolume].map((g) => g.produto_id));

  // Espaço para subir preço.
  const margemPorProduto = new Map(margens.map((m) => [m.produto_id, m]));
  const espacoParaSubir = [...giroAlto]
    .sort()
    .map((id) => margemPorProduto.get(id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined && m.abaixo_da_meta === true);
  const giroAltoSemEspaco = [...giroAlto]
    .sort()
    .map((id) => margemPorProduto.get(id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined && m.abaixo_da_meta === false);

  // Estoque parado: só produto que já foi comprado.
  const estoque = catalogo
    .filter((produto) => ultimaCompra.has(produto.id))
    .map((produto) => {
      const ultima = ultimaVenda.get(produto.id) ?? null;
      const diasSemVenda = ultima === null ? null : diasEntre(ultima, ref);
      return {
        produto_id: produto.id,
        nome: produto.nome,
        ultima_venda: ultima,
        dias_sem_venda: diasSemVenda,
        dispara_alerta: diasSemVenda !== null && diasSemVenda > LIMITE_ESTOQUE_PARADO,
      };
    })
    .filter((e) => (e.dias_sem_venda ?? 0) > 0)
    .sort((a, b) => (b.dias_sem_venda ?? 0) - (a.dias_sem_venda ?? 0))
    .slice(0, 5);

  // Ticket médio por dia e quedas relevantes.
  const serieDiaria = dias.map((data) => {
    const faturamento = faturamentoPorDia.get(data) ?? 0;
    const cupons = cuponsPorDia.get(data)?.size ?? 0;
    const doDia = extrato.filter((t) => t.data === data);
    const gastos = doDia.filter((t) => t.tipo === "saida");
    return {
      data,
      faturamento_centavos: faturamento,
      cupons,
      ticket_medio_centavos: cupons > 0 ? Math.round(faturamento / cupons) : null,
      gastos_total_centavos: gastos.reduce((s, t) => s + t.valor, 0),
      gastos_operacionais_centavos: gastos
        .filter((t) => t.categoria === "despesa_operacional")
        .reduce((s, t) => s + t.valor, 0),
    };
  });
  const ticketPorDia = serieDiaria.map((dia, indice) => {
    const anteriores = serieDiaria.slice(Math.max(0, indice - 28), indice);
    if (anteriores.length < 28 || dia.ticket_medio_centavos === null) return { ...dia, base: null };
    const fat = anteriores.reduce((s, d) => s + d.faturamento_centavos, 0);
    const cup = anteriores.reduce((s, d) => s + d.cupons, 0);
    const base = Math.round(fat / cup);
    const queda = bps(base - dia.ticket_medio_centavos, base);
    return {
      ...dia,
      base: { media_28_dias_centavos: base, queda_bps: queda, queda_percentual: percentual(queda) },
    };
  });
  const quedasRelevantes = ticketPorDia.filter((d) => d.base && d.base.queda_bps >= LIMITE_QUEDA_TICKET_BPS);
  const diaRef = ticketPorDia[ticketPorDia.length - 1];

  // Gasto fora do padrão.
  const operacional = serieDiaria.map((d) => d.gastos_operacionais_centavos);
  const desvios = serieDiaria.flatMap((dia, indice) => {
    const historico = operacional.slice(
      Math.max(0, indice - PARAMETROS.gasto_fora_do_padrao.janela_dias),
      indice,
    );
    if (historico.length < PARAMETROS.gasto_fora_do_padrao.minimo_dias_de_historico) return [];
    const med = mediana(historico);
    const mad = mediana(historico.map((v) => Math.abs(v - med)));
    const valor = dia.gastos_operacionais_centavos;
    const z = mad > 0 ? Math.round(((valor - med) / mad) * 100) / 100 : null;
    return [
      {
        data: dia.data,
        valor_centavos: valor,
        mediana_centavos: med,
        desvio_absoluto_mediano_centavos: mad,
        desvio: z,
        n_registros: historico.length,
        dispara_alerta: z !== null && z > LIMITE_DESVIO,
      },
    ];
  });
  const gastosAnormais = desvios.filter((d) => d.dispara_alerta);

  // Resumo diário.
  const resumo = (data: string) => {
    const indice = serieDiaria.findIndex((d) => d.data === data);
    const dia = serieDiaria[indice] as (typeof serieDiaria)[number];
    const anteriores = serieDiaria.slice(Math.max(0, indice - 7), indice);
    const mediaFat = Math.round(
      anteriores.reduce((s, d) => s + d.faturamento_centavos, 0) / anteriores.length,
    );
    const entradasAte = extrato
      .filter((t) => t.data <= data && t.tipo === "entrada")
      .reduce((s, t) => s + t.valor, 0);
    const saidasAte = extrato
      .filter((t) => t.data <= data && t.tipo === "saida")
      .reduce((s, t) => s + t.valor, 0);
    return {
      data,
      faturamento_centavos: dia.faturamento_centavos,
      gastos_centavos: dia.gastos_total_centavos,
      saldo_do_dia_centavos: dia.faturamento_centavos - dia.gastos_total_centavos,
      saldo_da_conta_centavos: perfil.saldo_inicial_conta_centavos + entradasAte - saidasAte,
      cupons: dia.cupons,
      ticket_medio_centavos: dia.ticket_medio_centavos,
      media_faturamento_7_dias_anteriores_centavos: mediaFat,
      variacao_faturamento_bps: bps(dia.faturamento_centavos - mediaFat, mediaFat),
      n_registros: dia.cupons,
    };
  };

  // Autoverificação contra o plano de dados.
  const dispararamReajuste = variacoes
    .filter((v) => v.dispara_alerta)
    .map((v) => v.produto_id)
    .sort();
  afirmar(dispararamReajuste.join() === "P01,P03", `reajustes que disparam: ${dispararamReajuste.join()}`);
  afirmar(
    estoque
      .filter((e) => e.dispara_alerta)
      .map((e) => e.produto_id)
      .join() === "P12",
    "estoque parado deveria ser só P12",
  );
  afirmar(
    quedasRelevantes.map((d) => d.data).join() === ref,
    `quedas de ticket: ${quedasRelevantes.map((d) => d.data).join()}`,
  );
  afirmar(
    gastosAnormais.map((d) => d.data).join() === ref,
    `gastos fora do padrão: ${gastosAnormais.map((d) => d.data).join()}`,
  );
  afirmar(
    margemAbaixoDaMeta.map((m) => m.produto_id).join() === "P01,P03,P17,P23",
    `margens abaixo da meta: ${margemAbaixoDaMeta.map((m) => m.produto_id).join()}`,
  );
  afirmar(
    espacoParaSubir.some((m) => m.produto_id === "P17") &&
      espacoParaSubir.some((m) => m.produto_id === "P23"),
    "P17 e P23 deveriam ter espaço para subir preço",
  );
  afirmar(
    topAlta.some((g) => g.produto_id === "P47") && topAlta.some((g) => g.produto_id === "P17"),
    "P47 e P17 deveriam estar entre as maiores altas",
  );
  afirmar(
    desvios.every((d) => d.desvio === null || Math.abs(Math.abs(d.desvio) - LIMITE_DESVIO) > 0.2),
    "algum desvio robusto está perto demais do limite",
  );

  const alertas = [
    ...variacoes
      .filter((v) => v.dispara_alerta)
      .map((v) => ({
        tipo: "reajuste_de_custo",
        produto_id: v.produto_id,
        fornecedor_id: v.fornecedor_id,
        gatilho: `nota ${v.compra_atual.nota} de ${v.compra_atual.data}`,
        metricas: {
          variacao_bps: v.variacao_bps,
          custo_anterior_centavos: v.custo_anterior_centavos,
          custo_atual_centavos: v.custo_atual_centavos,
        },
      })),
    ...margemAbaixoDaMeta.map((m) => ({
      tipo: "margem_abaixo_da_meta",
      produto_id: m.produto_id,
      gatilho: `data ${ref}`,
      metricas: { margem_bps: m.margem_bps, meta_bps: meta },
    })),
    ...espacoParaSubir.map((m) => ({
      tipo: "espaco_para_subir_preco",
      produto_id: m.produto_id,
      gatilho: `data ${ref}`,
      metricas: { margem_bps: m.margem_bps, meta_bps: meta },
    })),
    ...topAlta.map((g) => ({
      tipo: "giro_em_alta",
      produto_id: g.produto_id,
      gatilho: `data ${ref}`,
      metricas: { alta_bps: g.alta_bps, unidades_7_dias: g.unidades_7_dias },
    })),
    ...estoque
      .filter((e) => e.dispara_alerta)
      .map((e) => ({
        tipo: "estoque_parado",
        produto_id: e.produto_id,
        gatilho: `data ${ref}`,
        metricas: { dias_sem_venda: e.dias_sem_venda, ultima_venda: e.ultima_venda },
      })),
    ...quedasRelevantes.map((d) => ({
      tipo: "ticket_medio_em_queda",
      produto_id: null,
      gatilho: `data ${d.data}`,
      metricas: {
        ticket_medio_centavos: d.ticket_medio_centavos,
        media_28_dias_centavos: d.base?.media_28_dias_centavos,
        queda_bps: d.base?.queda_bps,
      },
    })),
    ...gastosAnormais.map((d) => ({
      tipo: "gasto_fora_do_padrao",
      produto_id: null,
      gatilho: `data ${d.data}`,
      metricas: { valor_centavos: d.valor_centavos, mediana_centavos: d.mediana_centavos, desvio: d.desvio },
    })),
  ];

  const naoDevemDisparar = [
    ...variacoes
      .filter((v) => !v.dispara_alerta)
      .map((v) => ({
        tipo: "reajuste_de_custo",
        produto_id: v.produto_id,
        fornecedor_id: v.fornecedor_id,
        motivo:
          v.variacao_bps < 0
            ? "o custo caiu"
            : `variação de ${v.variacao_percentual}% não passa do limite de 5%`,
      })),
    {
      tipo: "reajuste_de_custo",
      produto_id: "P01",
      fornecedor_id: "MIX",
      motivo:
        "arroz comprado do Atacado Mix a custo maior que o da Aurora; é outro fornecedor e há uma só compra, não é reajuste",
    },
    ...estoque
      .filter((e) => !e.dispara_alerta && (e.dias_sem_venda ?? 0) >= 20)
      .map((e) => ({
        tipo: "estoque_parado",
        produto_id: e.produto_id,
        motivo: `${e.dias_sem_venda} dias sem venda, abaixo do limite de ${LIMITE_ESTOQUE_PARADO}`,
      })),
    ...ticketPorDia
      .filter((d) => d.base && d.base.queda_bps >= 1500 && d.base.queda_bps < LIMITE_QUEDA_TICKET_BPS)
      .map((d) => ({
        tipo: "ticket_medio_em_queda",
        data: d.data,
        motivo: `queda de ${d.base?.queda_percentual}% não passa do limite de 30%`,
      })),
    ...desvios
      .filter((d) => d.desvio !== null && d.desvio > 2 && !d.dispara_alerta)
      .map((d) => ({
        tipo: "gasto_fora_do_padrao",
        data: d.data,
        motivo: `desvio robusto de ${d.desvio}, abaixo do limite de 3`,
      })),
    ...giroAltoSemEspaco.map((m) => ({
      tipo: "espaco_para_subir_preco",
      produto_id: m.produto_id,
      motivo: `giro alto, mas margem de ${m.margem_percentual}% já está acima da meta`,
    })),
    ...margens
      .filter((m) => m.situacao !== "ok")
      .map((m) => ({
        tipo: "margem_abaixo_da_meta",
        produto_id: m.produto_id,
        motivo:
          m.situacao === "sem_custo"
            ? "sem nota de compra: margem não calculável, o agente deve perguntar o custo"
            : "sem venda nos últimos 30 dias: preço médio indisponível",
      })),
  ];

  const resultado = {
    descricao:
      "Respostas corretas calculadas à parte, a partir dos arquivos de fixtures/mercadinho e fixtures/notas. Dinheiro em centavos inteiros; razões em pontos-base (bps).",
    gerado_por: "npm run fixtures:gerar (scripts/fixtures/gabarito.ts)",
    parametros: PARAMETROS,
    meta_margem_bps: meta,
    fornecedores: fornecedores.map((f) => ({ id: f.id, nome: f.nome })),
    resumo_diario: { referencia: resumo(ref), dia_anterior: resumo(somarDias(ref, -1)) },
    margem_por_produto: margens,
    variacao_de_custo: variacoes,
    giro: {
      periodo: {
        ultimos_7_dias: { inicio: inicio7, fim: ref },
        anteriores_28_dias: { inicio: inicio28, fim: fim28 },
      },
      maior_alta: topAlta,
      maior_volume: topVolume,
      por_produto: giro,
    },
    espaco_para_subir_preco: espacoParaSubir.map((m) => ({
      produto_id: m.produto_id,
      nome: m.nome,
      margem_bps: m.margem_bps,
    })),
    estoque_parado: estoque,
    ticket_medio: {
      dia_de_referencia: diaRef,
      dias_com_queda_relevante: quedasRelevantes.map((d) => d.data),
      por_dia: ticketPorDia,
    },
    gasto_fora_do_padrao: {
      dias_que_disparam: gastosAnormais.map((d) => d.data),
      por_dia: desvios,
    },
    alertas_esperados: alertas,
    alertas_que_nao_devem_disparar: naoDevemDisparar,
    serie_diaria: serieDiaria,
  };
  escreverJson(resolve(DIR_GABARITO, "metricas.json"), resultado);
}
