import { Logger } from "@nestjs/common";
import { z } from "zod";
import { AgenteService } from "../agente/agente.service";
import type { ExecucaoRegistrada, RegistroExecucoes } from "../agente/execucao/registro-execucoes";
import { definirFerramenta } from "../agente/ferramentas/ferramenta";
import { RegistroFerramentas } from "../agente/ferramentas/registro-ferramentas";
import { carregarPromptSistema } from "../agente/prompts/prompt-sistema";
import { chamar, ModeloRoteirizado, texto } from "./modelo-roteirizado";
import { executarRodada, RegistroCapturador, type OpcoesRodada } from "./runner";
import type { CasoAvaliacao } from "./tipos";

class RegistroEmMemoria implements RegistroExecucoes {
  readonly salvas: ExecucaoRegistrada[] = [];
  salvar(execucao: ExecucaoRegistrada): Promise<string> {
    this.salvas.push(execucao);
    return Promise.resolve(`exec-${this.salvas.length}`);
  }
}

const resumoDoDia = definirFerramenta({
  nome: "get_daily_summary",
  descricao: "Resumo do dia.",
  entrada: z.strictObject({}),
  efeito: "nenhum",
  executar: () => Promise.resolve({ faturamento_centavos: 122151, menor_confianca: 1 }),
});

const caso = (extra: Partial<CasoAvaliacao> = {}): CasoAvaliacao => ({
  id: "c1",
  categoria: "numerica",
  descricao: "Quanto vendi ontem?",
  gatilho: "mensagem_dono",
  entrada: "Quanto vendi ontem?",
  ferramentasEsperadas: ["get_daily_summary"],
  criterio: {
    tipo: "numero_correto",
    numeros: [{ rotulo: "faturamento", valor: 122151, unidade: "centavos" }],
  },
  roteiro: [chamar("get_daily_summary", {}, "t1"), texto("Ontem você vendeu R$ 1.221,51.")],
  ...extra,
});

function opcoes(casos: CasoAvaliacao[], destino = new RegistroEmMemoria()): OpcoesRodada {
  return {
    casos,
    modo: "falso",
    modelo: "falso-roteirizado",
    versaoPrompt: "sistema-v2",
    comercianteId: "dono-1",
    nomeComercio: "Mercadinho Teste",
    dataReferencia: "2026-10-20",
    registro: destino,
    agora: () => new Date("2026-10-20T12:00:00Z"),
    criarAgente: (c, registro) =>
      new AgenteService(
        new ModeloRoteirizado(c.roteiro ?? []),
        new RegistroFerramentas([resumoDoDia]),
        registro,
        carregarPromptSistema(),
        { maxIteracoes: 6, maxRegeracoes: 1 },
      ),
  };
}

describe("executarRodada", () => {
  // O agente avisa que o modelo falso não tem preço e registra o erro do roteiro curto: ruído nos testes.
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it("roda o caso pelo agente de verdade e devolve custo, latência, ferramentas e o veredito", async () => {
    const destino = new RegistroEmMemoria();
    const rodada = await executarRodada(opcoes([caso()], destino));

    expect(rodada).toMatchObject({
      iniciadaEm: "2026-10-20T12:00:00.000Z",
      modo: "falso",
      versaoPrompt: "sistema-v2",
      comerciante: "Mercadinho Teste",
      dataReferencia: "2026-10-20",
    });
    expect(rodada.resultados).toHaveLength(1);
    expect(rodada.resultados[0]).toMatchObject({
      id: "c1",
      aprovado: true,
      motivos: [],
      resultadoAgente: "aprovada",
      mensagem: "Ontem você vendeu R$ 1.221,51.",
      ferramentasChamadas: [{ ferramenta: "get_daily_summary", erro: null }],
      bloqueios: 0,
      iteracoes: 2,
      modelo: "falso-roteirizado",
      custoEstimadoMicrodolares: 0,
      execucaoId: "exec-1",
    });
    // A execução também foi registrada no destino real (o Postgres, na CLI).
    expect(destino.salvas).toHaveLength(1);
  });

  it("passa a data da rodada ao agente e deixa o caso trocá-la", async () => {
    const vistas: string[] = [];
    const base = opcoes([caso(), caso({ id: "c2", dataReferencia: "2026-10-19" })]);
    base.criarAgente = (c, registro) => {
      const agente = new AgenteService(
        new ModeloRoteirizado(c.roteiro ?? []),
        new RegistroFerramentas([
          definirFerramenta({
            nome: "get_daily_summary",
            descricao: "x",
            entrada: z.strictObject({}),
            efeito: "nenhum",
            executar: (ctx) => {
              vistas.push(ctx.dataReferencia);
              return Promise.resolve({ faturamento_centavos: 122151 });
            },
          }),
        ]),
        registro,
        carregarPromptSistema(),
        { maxIteracoes: 6, maxRegeracoes: 1 },
      );
      return agente;
    };
    await executarRodada(base);
    expect(vistas).toEqual(["2026-10-20", "2026-10-19"]);
  });

  it("reprova com o motivo quando o número está errado, e o resto da rodada continua", async () => {
    const errado = caso({
      id: "errado",
      criterio: {
        tipo: "numero_correto",
        numeros: [{ rotulo: "faturamento", valor: 999900, unidade: "centavos" }],
      },
    });
    const rodada = await executarRodada(opcoes([errado, caso({ id: "certo" })]));

    const [primeiro, segundo] = rodada.resultados;
    expect(primeiro?.aprovado).toBe(false);
    expect(primeiro?.motivos).toEqual([expect.stringContaining("faturamento")]);
    expect(segundo?.aprovado).toBe(true);
  });

  it("reprova quando a ferramenta esperada não foi chamada", async () => {
    const semFerramenta = caso({
      roteiro: [texto("Ontem você vendeu bem.")],
      criterio: { tipo: "sem_resposta" },
      ferramentasEsperadas: ["get_daily_summary"],
    });
    const [r] = (await executarRodada(opcoes([semFerramenta]))).resultados;
    expect(r?.aprovado).toBe(false);
    expect(r?.motivos.join(" ")).toContain("Ferramenta esperada não chamada: get_daily_summary");
  });

  it("caso que quebra vira falha com o motivo e não derruba a rodada", async () => {
    const base = opcoes([caso({ id: "quebra" }), caso({ id: "segue" })]);
    const montar = base.criarAgente;
    base.criarAgente = (c, registro) => {
      if (c.id === "quebra") throw new Error("caso sem roteiro");
      return montar(c, registro);
    };
    const rodada = await executarRodada(base);

    expect(rodada.resultados[0]).toMatchObject({
      id: "quebra",
      aprovado: false,
      resultadoAgente: "sem_execucao",
      execucaoId: null,
      motivos: ["Erro ao executar o caso: caso sem roteiro"],
    });
    expect(rodada.resultados[1]?.aprovado).toBe(true);
  });

  it("roteiro que acaba antes da hora vira fallback de erro, reprovado com o erro registrado", async () => {
    const curto = caso({ roteiro: [chamar("get_daily_summary", {}, "t1")] });
    const [r] = (await executarRodada(opcoes([curto]))).resultados;
    expect(r?.aprovado).toBe(false);
    expect(r?.resultadoAgente).toBe("fallback_erro");
    expect(r?.motivos[0]).toContain("Roteiro do modelo acabou");
  });
});

describe("RegistroCapturador", () => {
  it("repassa ao destino e devolve o que foi registrado pelo id", async () => {
    const destino = new RegistroEmMemoria();
    const capturador = new RegistroCapturador(destino);
    const execucao = { gatilho: "mensagem_dono" } as ExecucaoRegistrada;

    const id = await capturador.salvar(execucao);

    expect(destino.salvas).toEqual([execucao]);
    expect(capturador.execucao(id)).toBe(execucao);
    expect(capturador.execucao("outro")).toBeUndefined();
  });
});
