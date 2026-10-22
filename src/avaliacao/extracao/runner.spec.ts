import {
  ErroClienteVisao,
  type ClienteVisao,
  type RespostaVisao,
} from "../../ingestao/extracao/cliente-visao";
import type { ExtracaoNota } from "../../ingestao/extracao/esquema-extracao";
import { ExtratorNotas } from "../../ingestao/extracao/extrator-notas";
import { carregarPromptExtrator } from "../../ingestao/extracao/prompt-extrator";
import { renderizarRelatorio, resumir } from "./relatorio";
import { ErroAvaliacaoExtracao, lerEnvExtracao, rodarAvaliacaoExtracao } from "./rodada";
import { avaliarExtracao, carregarNotas, hojeDoGabarito, imagemDaNota } from "./runner";

const notas = carregarNotas();
const env = lerEnvExtracao({});

/** Cliente que "lê" cada foto pelo gabarito, depois de `alterar` mexer na cópia (ou lançar/devolver lixo). */
function clienteComDefeito(
  alterar: (id: string, nota: ExtracaoNota) => ExtracaoNota | string | Error,
  modelo = "claude-sonnet-5-5",
): ClienteVisao {
  const porImagem = new Map(notas.map((n) => [imagemDaNota(n).base64, n]));
  return {
    extrair(pedido) {
      const n = porImagem.get(pedido.imagem.base64);
      if (!n) return Promise.reject(new Error("foto desconhecida"));
      const r = alterar(n.id, structuredClone(n.esperado));
      if (r instanceof Error) return Promise.reject(r);
      const resposta: RespostaVisao = {
        texto: typeof r === "string" ? r : JSON.stringify(r),
        recusou: false,
        consumo: { entrada: 2000, saida: 800, cacheLeitura: 0, cacheEscrita: 0 },
        modelo,
      };
      return Promise.resolve(resposta);
    },
  };
}

const rodar = (alterar: Parameters<typeof clienteComDefeito>[0], ids?: string[], modelo?: string) =>
  rodarAvaliacaoExtracao({
    modo: "real",
    env,
    cliente: clienteComDefeito(alterar, modelo),
    ...(ids ? { notas: ids } : {}),
  });

describe("fixtures de extração", () => {
  it("carrega as 17 fotos do manifesto e deixa a NF-e em XML de fora", () => {
    expect(notas).toHaveLength(17);
    expect(notas.map((n) => n.id)).not.toContain("nota-18");
    expect(notas.every((n) => n.esperado.itens.length > 0)).toBe(true);
  });

  it("hoje das validações é o dia seguinte à data de referência do gabarito", () => {
    expect(hojeDoGabarito()).toBe("2026-10-20");
  });
});

describe("avaliação da extração", () => {
  it("leitura igual ao gabarito: 17 totais certos, nenhum erro, e a nota 10 sai com o documento em dúvida", async () => {
    const rodada = await rodar((_, n) => n);
    const r = resumir(rodada);
    expect(r.totalCorreto).toEqual({ certos: 17, total: 17 });
    expect(r.erros).toEqual({ total: 0, sinalizados: 0, silenciosos: 0 });
    expect(r.campos.certos).toBe(r.campos.total);
    expect(r.metas).toEqual({ totalCorreto: true, errosComConfiancaBaixa: true, exigenciasPorNota: true });
    expect(r.exigenciasNaoCumpridas).toEqual([]);
    // O código reduz a confiança onde o gabarito já a marca baixa: nota 10 (soma) e nota 11 (item borrado).
    const n10 = rodada.resultados.find((x) => x.id === "nota-10");
    expect(n10?.motivosValidacao).toContain("soma_diverge_do_total");
    expect(n10?.extracao?.confianca_documento).toBe(0.5);
    expect(r.confianca.itensAbaixoDoLimite).toBe(1);
    expect(r.confianca.itensBaixosCapturados).toBe(r.confianca.itensEsperadosBaixos);
    expect(r.confianca.documentosBaixosCapturados).toBe(r.confianca.documentosEsperadosBaixos);
    expect(r.custoTotalMicrodolares).toBeGreaterThan(0);
  });

  it("total lido errado com o resto consistente passa em silêncio e derruba a meta", async () => {
    // Troca o unitário e o total do primeiro item e o total da nota, de modo que soma e conta continuam batendo.
    const rodada = await rodar((id, n) => {
      if (id !== "nota-01") return n;
      const [primeiro, ...resto] = n.itens;
      if (!primeiro) return n;
      const unitario = primeiro.valor_unitario_centavos + 10;
      const total = Math.round(primeiro.quantidade * unitario);
      const dif = total - primeiro.valor_total_centavos;
      return {
        ...n,
        itens: [{ ...primeiro, valor_unitario_centavos: unitario, valor_total_centavos: total }, ...resto],
        total_centavos: n.total_centavos + dif,
      };
    });
    const r = resumir(rodada);
    expect(r.totalCorreto).toEqual({ certos: 16, total: 17 });
    expect(r.erros.silenciosos).toBe(3);
    expect(r.metas).toMatchObject({ totalCorreto: true, errosComConfiancaBaixa: false });
    expect(rodada.resultados.find((x) => x.id === "nota-01")?.motivosValidacao).toEqual([]);
  });

  it("erro que o código pega na validação sai com o documento abaixo do limite e conta como sinalizado", async () => {
    // Só o total errado: a soma dos itens deixa de bater, o código derruba a confiança do documento.
    const rodada = await rodar((id, n) =>
      id === "nota-02" ? { ...n, total_centavos: n.total_centavos + 500 } : n,
    );
    const r = resumir(rodada);
    expect(r.totalCorreto.certos).toBe(16);
    expect(r.erros).toEqual({ total: 1, sinalizados: 1, silenciosos: 0 });
    expect(r.metas.errosComConfiancaBaixa).toBe(true);
  });

  it("meta de 90% do total: 16 de 17 passa, 15 de 17 não", async () => {
    const errar = (ids: string[]) => (id: string, n: ExtracaoNota) =>
      ids.includes(id) ? { ...n, total_centavos: n.total_centavos + 1000 } : n;
    expect(resumir(await rodar(errar(["nota-01"]))).metas.totalCorreto).toBe(true);
    expect(resumir(await rodar(errar(["nota-01", "nota-02"]))).metas.totalCorreto).toBe(false);
  });

  it("JSON inválido nas duas tentativas: a nota conta como falha sinalizada", async () => {
    const rodada = await rodar((id, n) => (id === "nota-03" ? "isto não é JSON" : n));
    const x = rodada.resultados.find((r) => r.id === "nota-03");
    expect(x?.falha?.tipo).toBe("json_invalido");
    expect(x?.tentativas).toBe(2);
    expect(x?.comparacao).toBeNull();
    const r = resumir(rodada);
    expect(r.falhas.map((f) => f.id)).toEqual(["nota-03"]);
    expect(r.totalCorreto).toEqual({ certos: 16, total: 17 });
    expect(r.erros).toEqual({ total: 1, sinalizados: 1, silenciosos: 0 });
    // A nota que não saiu entra nos campos como errada, com o total vindo do gabarito.
    expect(r.campos.total).toBe(resumir(await rodar((_, n) => n)).campos.total);
    expect(r.campos.certos).toBeLessThan(r.campos.total);
  });

  it("erro transitório da API não derruba a rodada: vira falha daquela nota", async () => {
    const rodada = await rodar((id, n) => (id === "nota-04" ? new ErroClienteVisao("429", true) : n));
    expect(rodada.resultados).toHaveLength(17);
    expect(rodada.resultados.find((r) => r.id === "nota-04")?.falha).toEqual({
      tipo: "erro_transitorio",
      mensagem: "429",
    });
  });

  it("nota ilegível devolvida pelo modelo vira falha 'ilegivel'", async () => {
    const rodada = await rodar(() => '{"erro":"ilegivel","motivo":"foto escura"}', ["nota-05"]);
    expect(rodada.resultados[0]?.falha).toEqual({ tipo: "ilegivel", mensagem: "foto escura" });
  });

  it("nota 12 com texto de injeção: o gabarito não traz a instrução e a leitura igual a ele passa", async () => {
    const rodada = await rodar((_, n) => n, ["nota-12"]);
    expect(rodada.resultados[0]?.casos).toContain("texto_de_injecao");
    expect(resumir(rodada).totalCorreto).toEqual({ certos: 1, total: 1 });
  });
});

describe("rodarAvaliacaoExtracao", () => {
  it("modo falso: lê o gabarito, sem chave e sem custo", async () => {
    const rodada = await rodarAvaliacaoExtracao({ modo: "falso", env });
    const r = resumir(rodada);
    expect(rodada.modelo).toBe("extrator-falso");
    expect(rodada.versaoPrompt).toBe("extrator-v1");
    expect(r.totalCorreto).toEqual({ certos: 17, total: 17 });
    expect(r.custoTotalMicrodolares).toBe(0);
  });

  it("modo real sem ANTHROPIC_API_KEY para antes de chamar qualquer coisa", async () => {
    await expect(rodarAvaliacaoExtracao({ modo: "real", env })).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("nota inexistente é erro de uso", async () => {
    await expect(rodarAvaliacaoExtracao({ modo: "falso", env, notas: ["nota-99"] })).rejects.toBeInstanceOf(
      ErroAvaliacaoExtracao,
    );
  });

  it("o limite vem do ambiente e pode ser trocado na chamada", async () => {
    expect(env.LIMITE_CONFIANCA_ITEM).toBe(0.8);
    const rodada = await rodarAvaliacaoExtracao({ modo: "falso", env, limiteConfianca: 0.6 });
    expect(rodada.limiteConfianca).toBe(0.6);
  });
});

describe("falha do avaliador não certifica a rodada", () => {
  it("exceção que não é erro transitório do cliente sobe, em vez de virar falha da nota", async () => {
    await expect(
      rodar((id, n) => (id === "nota-04" ? new TypeError("bug do avaliador") : n)),
    ).rejects.toThrow("bug do avaliador");
  });

  it("foto ausente derruba a rodada, em vez de virar erro_transitorio e passar com 16 de 17", async () => {
    const [primeira, ...resto] = notas;
    if (!primeira) throw new Error("fixtures vazias");
    const semFoto = { ...primeira, arquivoImagem: "fixtures/notas/nao-existe.jpg" };
    const extrator = new ExtratorNotas(
      clienteComDefeito((_, n) => n),
      carregarPromptExtrator(),
    );
    await expect(
      avaliarExtracao({
        extrator,
        notas: [semFoto, ...resto],
        hoje: hojeDoGabarito(),
        modo: "real",
        modelo: "claude-sonnet-5-5",
        versaoPrompt: "extrator-v1",
      }),
    ).rejects.toThrow(/ENOENT/);
  });
});

describe("resultados exigidos por nota", () => {
  it("nota 11 lida certa com confiança 1 no item borrado: passa nas metas agregadas, mas reprova na exigência", async () => {
    const rodada = await rodar((id, n) => {
      if (id !== "nota-11") return n;
      return { ...n, itens: n.itens.map((i) => ({ ...i, confianca: 1 })) };
    });
    const r = resumir(rodada);
    expect(r.metas).toEqual({ totalCorreto: true, errosComConfiancaBaixa: true, exigenciasPorNota: false });
    expect(r.exigenciasNaoCumpridas).toEqual([
      "nota-11: o item 3 (pouco legível no gabarito) deveria sair abaixo de 0,8",
    ]);
    expect(renderizarRelatorio(rodada)).toContain("1 não cumpridos");
  });

  it("nota 10 com um item alterado para a soma bater: o código não acusa a divergência e a exigência falha", async () => {
    const rodada = await rodar((id, n) => {
      if (id !== "nota-10") return n;
      const soma = n.itens.reduce((s, i) => s + i.valor_total_centavos, 0);
      const ultimo = n.itens.at(-1);
      if (!ultimo) return n;
      const itens = [
        ...n.itens.slice(0, -1),
        { ...ultimo, valor_total_centavos: ultimo.valor_total_centavos + (n.total_centavos - soma) },
      ];
      return { ...n, itens };
    });
    const r = resumir(rodada);
    const n10 = rodada.resultados.find((x) => x.id === "nota-10");
    expect(n10?.motivosValidacao).not.toContain("soma_diverge_do_total");
    // O total impresso está certo e o erro do item é coberto pelo documento em dúvida: sem a exigência, passaria.
    expect(r.metas).toMatchObject({ totalCorreto: true, errosComConfiancaBaixa: true });
    expect(r.metas.exigenciasPorNota).toBe(false);
    expect(r.exigenciasNaoCumpridas).toEqual(["nota-10: o código deveria acusar soma_diverge_do_total"]);
  });

  it("nota que não saiu também não cumpre a exigência dela", async () => {
    const r = resumir(await rodar((id, n) => (id === "nota-11" ? "isto não é JSON" : n)));
    expect(r.metas.exigenciasPorNota).toBe(false);
    expect(r.exigenciasNaoCumpridas.length).toBeGreaterThan(0);
  });
});

describe("custo", () => {
  it("modelo sem preço (por exemplo o de um fallback do servidor) deixa o custo indisponível, não zero", async () => {
    const rodada = await rodar((_, n) => n, ["nota-01"], "modelo-sem-preco");
    expect(rodada.resultados[0]?.custoEstimadoMicrodolares).toBeNull();
    const r = resumir(rodada);
    expect(r.custoTotalMicrodolares).toBeNull();
    const md = renderizarRelatorio(rodada);
    expect(md).toContain("Custo estimado da rodada: indisponível");
    expect(md).not.toContain("US$ 0,0000");
  });

  it("modelo com preço tem custo calculado", async () => {
    const rodada = await rodar((_, n) => n, ["nota-01"]);
    expect(rodada.resultados[0]?.custoEstimadoMicrodolares).toBeGreaterThan(0);
  });

  it("EXTRATOR_MODELO sem preço cadastrado recusa a rodada real antes de chamar a API", async () => {
    const semPreco = lerEnvExtracao({
      ANTHROPIC_API_KEY: "chave-de-teste",
      EXTRATOR_MODELO: "modelo-sem-preco",
    });
    await expect(rodarAvaliacaoExtracao({ modo: "real", env: semPreco })).rejects.toThrow(/preço/);
  });
});
