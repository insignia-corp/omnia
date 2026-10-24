import {
  abaixoDoLimite,
  agruparChamadas,
  resumoDoDiaDe,
  versaoDoPainel,
  type DecisaoAlerta,
} from "./montar-painel";

describe("agruparChamadas", () => {
  it("agrupa por execução e ordena pela ordem da chamada", () => {
    const grupos = agruparChamadas([
      { execucaoId: "e1", ordem: 2 },
      { execucaoId: "e2", ordem: 1 },
      { execucaoId: "e1", ordem: 1 },
    ]);
    expect(grupos.get("e1")!.map((c) => c.ordem)).toEqual([1, 2]);
    expect(grupos.get("e2")).toHaveLength(1);
  });
});

describe("abaixoDoLimite", () => {
  it("só o que fica abaixo do limite é destacado", () => {
    expect(abaixoDoLimite(0.79, 0.8)).toBe(true);
    expect(abaixoDoLimite(0.8, 0.8)).toBe(false);
  });
});

describe("versaoDoPainel", () => {
  it("usa o instante mais recente e ignora vazios", () => {
    const v = versaoDoPainel([new Date(1000), null, new Date(5000), undefined]);
    expect(v).toBe("5000");
  });

  it("é '0' sem nada", () => {
    expect(versaoDoPainel([null])).toBe("0");
  });

  it("muda quando status ou justificativa de um alerta mudam, sem execução nova", () => {
    const decisao: DecisaoAlerta = {
      alerta_id: "a1",
      tipo: "reajuste_de_custo",
      prioridade: 1,
      status: "candidato",
      data_referencia: "2026-10-20",
      chave: "p1",
      metricas_apoio: {},
      justificativa: null,
      execucao_id: null,
    };
    const instantes = [new Date(5000)];
    const antes = versaoDoPainel(instantes, [decisao]);
    expect(versaoDoPainel(instantes, [{ ...decisao }])).toBe(antes);
    expect(versaoDoPainel(instantes, [{ ...decisao, status: "descartado" }])).not.toBe(antes);
    expect(versaoDoPainel(instantes, [{ ...decisao, justificativa: "repetido" }])).not.toBe(antes);
    expect(versaoDoPainel(instantes, [])).not.toBe(antes);
  });

  it("muda quando qualquer campo exibido da decisão muda", () => {
    const decisao: DecisaoAlerta = {
      alerta_id: "a1",
      tipo: "reajuste_de_custo",
      prioridade: 1,
      status: "candidato",
      data_referencia: "2026-10-20",
      chave: "p1",
      metricas_apoio: { variacao_bps: 300 },
      justificativa: null,
      execucao_id: null,
    };
    const instantes = [new Date(5000)];
    const antes = versaoDoPainel(instantes, [decisao]);
    const alteracoes: Partial<DecisaoAlerta>[] = [
      { metricas_apoio: { variacao_bps: 500 } },
      { tipo: "margem_baixa" },
      { data_referencia: "2026-10-21" },
      { chave: "p2" },
      { prioridade: 2 },
      { execucao_id: "e1" },
    ];
    for (const alteracao of alteracoes)
      expect(versaoDoPainel(instantes, [{ ...decisao, ...alteracao }])).not.toBe(antes);
  });

  it("não depende da ordem das chaves das métricas", () => {
    const base = {
      alerta_id: "a1",
      status: "candidato",
    } as DecisaoAlerta;
    const um = { ...base, metricas_apoio: { a: 1, b: { c: 2, d: 3 } } };
    const dois = { ...base, metricas_apoio: { b: { d: 3, c: 2 }, a: 1 } };
    expect(versaoDoPainel([null], [um])).toBe(versaoDoPainel([null], [dois]));
  });

  it("não depende da ordem das decisões", () => {
    const a = { alerta_id: "a", status: "candidato" } as DecisaoAlerta;
    const b = { alerta_id: "b", status: "enviado" } as DecisaoAlerta;
    expect(versaoDoPainel([null], [a, b])).toBe(versaoDoPainel([null], [b, a]));
  });
});

describe("resumoDoDiaDe", () => {
  it("converte o texto que o pg entrega em inteiros", () => {
    expect(
      resumoDoDiaDe("2026-10-24", { execucoes: "12", bloqueios: "1", custo: "180000", latencia: "4200" }),
    ).toEqual({
      data: "2026-10-24",
      execucoes: 12,
      bloqueios_verificador: 1,
      custo_microdolares: 180_000,
      latencia_media_ms: 4200,
    });
  });

  it("sem execuções no dia tudo é zero e a latência média é nula, não zero", () => {
    const vazio = resumoDoDiaDe("2026-10-24", { execucoes: "0", bloqueios: "0", custo: "0", latencia: null });
    expect(vazio).toMatchObject({ execucoes: 0, bloqueios_verificador: 0, custo_microdolares: 0 });
    expect(vazio.latencia_media_ms).toBeNull();
    expect(resumoDoDiaDe("2026-10-24", undefined).latencia_media_ms).toBeNull();
  });
});
