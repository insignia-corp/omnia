export type TipoArquivo = "jpeg" | "png" | "xml" | "csv" | "xlsx";

export const EXTENSAO: Record<TipoArquivo, string> = {
  jpeg: "jpg",
  png: "png",
  xml: "xml",
  csv: "csv",
  xlsx: "xlsx",
};

export const MIME: Record<TipoArquivo, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  xml: "application/xml",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const comecaCom = (b: Buffer, ...bytes: number[]) => bytes.every((v, i) => b[i] === v);

/** Texto sem bytes de controle (além de tab, quebra de linha e retorno de carro), em UTF-8 válido. */
function pareceTexto(b: Buffer): boolean {
  const amostra = b.subarray(0, 4096);
  for (const byte of amostra) {
    if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, Math.min(b.length, 65_536)));
    return true;
  } catch {
    // Um corte no meio de um caractere multibyte não invalida o texto inteiro.
    return b.length > 65_536;
  }
}

/**
 * Tipo do arquivo pelos primeiros bytes, nunca pela extensão ou pelo Content-Type enviado.
 * Devolve null para o que não é aceito.
 */
export function detectarTipo(conteudo: Buffer): TipoArquivo | null {
  if (comecaCom(conteudo, 0xff, 0xd8, 0xff)) return "jpeg";
  if (comecaCom(conteudo, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (comecaCom(conteudo, 0x50, 0x4b, 0x03, 0x04)) return "xlsx";
  if (conteudo.length === 0 || !pareceTexto(conteudo)) return null;
  const texto = conteudo.toString("utf8", 0, 512);
  // BOM de UTF-8 no começo (comum em CSV exportado do Excel).
  const inicio = (texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto).trimStart();
  if (inicio.startsWith("<?xml") || inicio.startsWith("<")) return "xml";
  const primeiraLinha = inicio.split(/\r?\n/, 1)[0] ?? "";
  return /[;,\t]/.test(primeiraLinha) ? "csv" : null;
}
