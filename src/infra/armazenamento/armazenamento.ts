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
  /** Apaga um arquivo. Silencioso quando ele não existe, para a exclusão poder ser repetida. */
  remover(caminho: string): Promise<void>;
  /**
   * Apaga todos os arquivos do comerciante. É o que a exclusão a pedido (LGPD) e a política de
   * retenção chamam junto com o `DELETE` no banco, que sozinho não alcança os arquivos.
   */
  removerDoComerciante(comercianteId: string): Promise<void>;
}

export const ARMAZENAMENTO = Symbol("ARMAZENAMENTO");
