import type { TipoArquivo } from "./tipo-arquivo";

export interface ArquivoSalvo {
  /** Caminho relativo à raiz do armazenamento: `<comerciante_id>/<sha256>.<ext>`. */
  caminho: string;
  /** SHA-256 do conteúdo em hexadecimal. */
  hash: string;
  bytes: number;
  tipo: TipoArquivo;
}

export type MotivoRecusa = "vazio" | "grande_demais" | "tipo_nao_aceito";

export class ErroArmazenamento extends Error {
  constructor(
    readonly motivo: MotivoRecusa,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/**
 * Porta do armazenamento de arquivos dos documentos (issue #22). Disco local em
 * desenvolvimento; uma implementação S3 troca só esta interface.
 */
export interface Armazenamento {
  salvar(comercianteId: string, conteudo: Buffer): Promise<ArquivoSalvo>;
  ler(caminho: string): Promise<Buffer>;
}

export const ARMAZENAMENTO = Symbol("ARMAZENAMENTO");
