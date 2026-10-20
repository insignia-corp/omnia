import { SaxesParser } from "saxes";
import { ErroDinheiro, parseDecimalNfe } from "../../lib/dinheiro/dinheiro";
import { extracaoNotaSchema, type ExtracaoNota } from "../extracao/esquema-extracao";

export type ErroNfe =
  "xml_invalido" | "doctype_proibido" | "nao_e_nfe" | "campo_ausente" | "valor_invalido" | "fora_do_esquema";

export type LeituraNfe =
  | {
      ok: true;
      extracao: ExtracaoNota;
      numeroDocumento: string | null;
      /** `cEAN` de cada item, na ordem; nulo quando a nota diz "SEM GTIN" ou não traz. */
      codigosBarras: Array<string | null>;
    }
  | { ok: false; erro: ErroNfe; mensagem: string };

/** A coluna `ordem` é smallint e o fluxo de perguntas não foi pensado para notas enormes. */
export const MAXIMO_ITENS_NFE = 990;

const QUANTIDADE = /^\d+(\.\d{1,4})?$/;
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
  if (!emissao || !/^\d{4}-\d{2}-\d{2}/.test(emissao))
    throw new ErroLeitura("campo_ausente", "NF-e sem data de emissão");
  const cnpj = campos.get(`${base}/emit/CNPJ`) ?? campos.get(`${base}/emit/CPF`) ?? "";
  const nome = exigir(`${base}/emit/xNome`, "nome do emitente");
  if (itens.length === 0) throw new ErroLeitura("campo_ausente", "NF-e sem itens");

  const extracao = extracaoNotaSchema.safeParse({
    fornecedor: { nome, cnpj: cnpj || "sem CNPJ" },
    data_emissao: emissao.slice(0, 10),
    itens: itens.map((i, n) => {
      const qtd = i.qCom ?? "";
      if (!QUANTIDADE.test(qtd))
        throw new ErroLeitura("valor_invalido", `Quantidade do item ${n + 1} inválida`);
      return {
        descricao: i.xProd ?? "",
        quantidade: Number(qtd),
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
  };
}

/** Caminho dos nomes locais; dentro de `det` (itens repetidos) a raiz é omitida para casar os itens. */
function caminho(pilha: string[]): string {
  const dentroDeDet = pilha.indexOf("det");
  return dentroDeDet >= 0 ? pilha.slice(dentroDeDet).join("/") : pilha.join("/");
}
