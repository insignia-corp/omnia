import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

export interface PlanilhaLida {
  cabecalhos: string[];
  /** Linhas de dados, sem o cabeçalho. Toda célula vira texto; célula vazia vira "". */
  linhas: string[][];
}

export class ErroPlanilha extends Error {}

const SEPARADORES = [";", ",", "\t"] as const;

/** Separador mais frequente na primeira linha (PDV brasileiro costuma usar ";"). */
function detectarSeparador(texto: string): string {
  // BOM de UTF-8 no começo (comum em CSV exportado do Excel).
  const semBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const primeira = semBom.split(/\r?\n/, 1)[0] ?? "";
  let melhor: string = ";";
  let max = 0;
  for (const s of SEPARADORES) {
    const n = primeira.split(s).length - 1;
    if (n > max) {
      max = n;
      melhor = s;
    }
  }
  return melhor;
}

export function lerCsv(conteudo: Buffer): PlanilhaLida {
  const texto = conteudo.toString("utf8");
  let linhas: string[][];
  try {
    linhas = parse(texto, {
      delimiter: detectarSeparador(texto),
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (e) {
    throw new ErroPlanilha(`CSV ilegível: ${e instanceof Error ? e.message : String(e)}`);
  }
  const [cabecalhos, ...dados] = linhas;
  if (!cabecalhos || cabecalhos.length === 0) throw new ErroPlanilha("Planilha sem cabeçalho");
  return { cabecalhos, linhas: dados };
}

/** Texto de uma célula do Excel. Data vira AAAA-MM-DD (o fuso do arquivo é UTC no exceljs). */
function textoDaCelula(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "object") {
    if ("result" in valor && valor.result !== undefined) return textoDaCelula(valor.result);
    if ("richText" in valor) return valor.richText.map((t) => t.text).join("");
    if ("text" in valor) return String(valor.text);
    return "";
  }
  return String(valor).trim();
}

export async function lerXlsx(conteudo: Buffer): Promise<PlanilhaLida> {
  const livro = new ExcelJS.Workbook();
  try {
    // O tipo de Buffer do exceljs é o antigo (sem o parâmetro de ArrayBuffer): mesma coisa em execução.
    await livro.xlsx.load(conteudo as unknown as Parameters<typeof livro.xlsx.load>[0]);
  } catch (e) {
    throw new ErroPlanilha(`XLSX ilegível: ${e instanceof Error ? e.message : String(e)}`);
  }
  const folha = livro.worksheets[0];
  if (!folha) throw new ErroPlanilha("Planilha sem abas");
  const linhas: string[][] = [];
  // `columnCount` percorre a folha toda a cada chamada: pedir uma vez, fora do laço das linhas.
  const colunas = folha.columnCount;
  folha.eachRow({ includeEmpty: false }, (linha) => {
    const celulas: string[] = [];
    for (let c = 1; c <= colunas; c++) celulas.push(textoDaCelula(linha.getCell(c).value));
    linhas.push(celulas);
  });
  const [cabecalhos, ...dados] = linhas;
  if (!cabecalhos || cabecalhos.length === 0) throw new ErroPlanilha("Planilha sem cabeçalho");
  return { cabecalhos, linhas: dados };
}

export function lerPlanilha(conteudo: Buffer, tipo: "csv" | "xlsx"): Promise<PlanilhaLida> {
  return tipo === "xlsx" ? lerXlsx(conteudo) : Promise.resolve(lerCsv(conteudo));
}
