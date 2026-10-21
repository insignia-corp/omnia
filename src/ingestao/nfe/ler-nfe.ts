import { SaxesParser } from "saxes";
import { ErroDinheiro, parseDecimalNfe } from "../../lib/dinheiro/dinheiro";
import { extracaoNotaSchema, type ExtracaoNota } from "../extracao/esquema-extracao";
import { TOLERANCIA_ITEM_CENTAVOS } from "../validacao/validar-nota";

export type ErroNfe =
  "xml_invalido" | "doctype_proibido" | "nao_e_nfe" | "campo_ausente" | "valor_invalido" | "fora_do_esquema";

export type LeituraNfe =
  | {
      ok: true;
      extracao: ExtracaoNota;
      numeroDocumento: string | null;
      /** `cEAN` de cada item, na ordem; nulo quando a nota diz "SEM GTIN" ou não traz. */
      codigosBarras: Array<string | null>;
      /**
       * Posições (a partir de 1) dos itens em que quantidade x unitário bate com o total do item usando o
       * unitário exato do XML (até 10 casas). O unitário gravado em centavos é arredondado, e só com o
       * exato a conta fecha para quantidades grandes.
       */
      itensConferidos: Set<number>;
    }
  | { ok: false; erro: ErroNfe; mensagem: string };

/** A coluna `ordem` é smallint e o fluxo de perguntas não foi pensado para notas enormes. */
export const MAXIMO_ITENS_NFE = 990;

const QUANTIDADE = /^\d+(\.\d{1,4})?$/;
/** `dhEmi` é RFC 3339 com fuso; `dEmi` (layout antigo) é só a data. A data de calendário sai do começo. */
const DATA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATA_SIMPLES = /^\d{4}-\d{2}-\d{2}$/;
const CONFIANCA_NFE = 1;

interface ItemBruto {
  xProd?: string;
  uCom?: string;
  qCom?: string;
  vUnCom?: string;
  vProd?: string;
  cEAN?: string;
}

class ErroLeitura extends Error {
  constructor(
    readonly erro: ErroNfe,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/**
 * Lê o XML de uma NF-e sem modelo (issue #29). Parser SAX que não lê DTD nem resolve entidades: um
 * DOCTYPE é recusado (XXE, entidades em cascata). Os elementos casam pelo nome local, então o prefixo
 * de namespace não importa. Só os campos de dado entram; texto livre (`infAdic`) é ignorado, e nada
 * do XML vira instrução (regra inviolável 6). Dinheiro por texto e inteiro, sem ponto flutuante.
 */
export function lerNfe(conteudo: Buffer): LeituraNfe {
  try {
    return { ok: true, ...extrair(conteudo) };
  } catch (e) {
    if (e instanceof ErroLeitura) return { ok: false, erro: e.erro, mensagem: e.message };
    throw e;
  }
}

function extrair(conteudo: Buffer): {
  extracao: ExtracaoNota;
  numeroDocumento: string | null;
  codigosBarras: Array<string | null>;
  itensConferidos: Set<number>;
} {
  const parser = new SaxesParser({ xmlns: true });
  const pilha: string[] = [];
  const itens: ItemBruto[] = [];
  const campos = new Map<string, string>();
  let raiz: string | null = null;
  let texto = "";
  let erroParser: Error | null = null;

  parser.on("error", (e) => {
    erroParser ??= e;
  });
  parser.on("doctype", () => {
    throw new ErroLeitura("doctype_proibido", "XML com DOCTYPE não é aceito");
  });
  parser.on("opentag", (tag) => {
    pilha.push(tag.local);
    raiz ??= tag.local;
    texto = "";
    if (caminho(pilha) === "det/prod") itens.push({});
    if (caminho(pilha) === "det" && itens.length >= MAXIMO_ITENS_NFE) {
      throw new ErroLeitura("fora_do_esquema", `NF-e com mais de ${MAXIMO_ITENS_NFE} itens`);
    }
  });
  parser.on("text", (t) => {
    texto += t;
  });
  // Texto em CDATA é o mesmo conteúdo de caractere, só escrito de outro jeito.
  parser.on("cdata", (t) => {
    texto += t;
  });
  parser.on("closetag", () => {
    const c = caminho(pilha);
    const valor = texto.trim();
    const item = itens.at(-1);
    if (c.startsWith("det/prod/") && item) {
      const nome = c.slice("det/prod/".length) as keyof ItemBruto;
      if (["xProd", "uCom", "qCom", "vUnCom", "vProd", "cEAN"].includes(nome)) item[nome] = valor;
    } else if (!c.startsWith("det")) {
      campos.set(c, valor);
    }
    pilha.pop();
    texto = "";
  });

  try {
    parser.write(conteudo.toString("utf8")).close();
  } catch (e) {
    if (e instanceof ErroLeitura) throw e;
    throw new ErroLeitura("xml_invalido", "XML malformado");
  }
  if (erroParser) throw new ErroLeitura("xml_invalido", "XML malformado");
  if (raiz !== "nfeProc" && raiz !== "NFe") throw new ErroLeitura("nao_e_nfe", "O arquivo não é uma NF-e");

  const exigir = (chave: string, rotulo: string): string => {
    const v = campos.get(chave);
    if (!v) throw new ErroLeitura("campo_ausente", `NF-e sem ${rotulo}`);
    return v;
  };
  const dinheiro = (texto: string, rotulo: string) => {
    try {
      return parseDecimalNfe(texto);
    } catch (e) {
      if (e instanceof ErroDinheiro) throw new ErroLeitura("valor_invalido", `${rotulo} inválido`);
      throw e;
    }
  };
  const base = raiz === "nfeProc" ? "nfeProc/NFe/infNFe" : "NFe/infNFe";
  const emissao = campos.get(`${base}/ide/dhEmi`) ?? campos.get(`${base}/ide/dEmi`);
  if (!emissao) throw new ErroLeitura("campo_ausente", "NF-e sem data de emissão");
  // Valida o valor inteiro antes de pegar só a data: "2026-10-18lixo" não pode virar "2026-10-18".
  if (!DATA_HORA.test(emissao) && !DATA_SIMPLES.test(emissao)) {
    throw new ErroLeitura("valor_invalido", "Data de emissão fora do formato da NF-e");
  }
  const cnpj = campos.get(`${base}/emit/CNPJ`) ?? campos.get(`${base}/emit/CPF`) ?? "";
  const nome = exigir(`${base}/emit/xNome`, "nome do emitente");
  if (itens.length === 0) throw new ErroLeitura("campo_ausente", "NF-e sem itens");

  const itensConferidos = new Set<number>();
  const extracao = extracaoNotaSchema.safeParse({
    // Sem CNPJ nem CPF o texto não passa na conferência de identificador e a nota vai para revisão.
    fornecedor: { nome, cnpj: cnpj || "sem identificador" },
    data_emissao: emissao.slice(0, 10),
    itens: itens.map((i, n) => {
      const qtd = i.qCom ?? "";
      if (!QUANTIDADE.test(qtd)) {
        throw new ErroLeitura("valor_invalido", `Quantidade do item ${n + 1} inválida`);
      }
      // O banco guarda três casas. Quantidade que precisaria da quarta é recusada, não arredondada.
      const [inteiro = "0", fracao = ""] = qtd.split(".");
      if (fracao.length === 4 && fracao[3] !== "0") {
        throw new ErroLeitura(
          "valor_invalido",
          `Quantidade do item ${n + 1} com mais de 3 casas decimais não é suportada`,
        );
      }
      if (totalExatoConfere(qtd, i.vUnCom ?? "", i.vProd ?? "")) itensConferidos.add(n + 1);
      return {
        descricao: i.xProd ?? "",
        quantidade: Number(fracao ? `${inteiro}.${fracao.slice(0, 3)}` : inteiro),
        unidade: i.uCom ?? "",
        valor_unitario_centavos: dinheiro(i.vUnCom ?? "", `Valor unitário do item ${n + 1}`),
        valor_total_centavos: dinheiro(i.vProd ?? "", `Valor do item ${n + 1}`),
        confianca: CONFIANCA_NFE,
      };
    }),
    total_centavos: dinheiro(exigir(`${base}/total/ICMSTot/vNF`, "total da nota"), "Total da nota"),
    confianca_documento: CONFIANCA_NFE,
  });
  if (!extracao.success) throw new ErroLeitura("fora_do_esquema", "NF-e fora do formato esperado");

  return {
    extracao: extracao.data,
    numeroDocumento: campos.get(`${base}/ide/nNF`) || null,
    codigosBarras: itens.map((i) => (i.cEAN && /^\d+$/.test(i.cEAN) ? i.cEAN : null)),
    itensConferidos,
  };
}

/** "24.0000" com 4 casas vira o inteiro 240000n; recusa o que tem casas demais ou não é decimal. */
function decimalFixo(texto: string, casas: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!m || (m[2] ?? "").length > casas) return null;
  return BigInt(`${m[1]}${(m[2] ?? "").padEnd(casas, "0")}`);
}

/**
 * Confere quantidade x unitário contra o total do item com o unitário exato do XML (até 10 casas), em
 * inteiros de precisão fixa. Fecha dentro de 1 centavo, a mesma folga da conferência em centavos.
 */
function totalExatoConfere(qtd: string, unitario: string, total: string): boolean {
  const q = decimalFixo(qtd, 4);
  const u = decimalFixo(unitario, 10);
  const t = decimalFixo(total, 2);
  if (q === null || u === null || t === null) return false;
  // q (1e4) x u (1e10) tem escala 1e14; o total em centavos (1e2) sobe para 1e14 multiplicando por 1e12.
  const diferenca = q * u - t * 10n ** 12n;
  return (diferenca < 0n ? -diferenca : diferenca) <= BigInt(TOLERANCIA_ITEM_CENTAVOS) * 10n ** 12n;
}

/** Caminho dos nomes locais; dentro de `det` (itens repetidos) a raiz é omitida para casar os itens. */
function caminho(pilha: string[]): string {
  const dentroDeDet = pilha.indexOf("det");
  return dentroDeDet >= 0 ? pilha.slice(dentroDeDet).join("/") : pilha.join("/");
}
