import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { ehUuid } from "../../lib/uuid/uuid";
import { ErroArmazenamento, type Armazenamento, type ArquivoSalvo } from "./armazenamento";
import { detectarTipo, EXTENSAO, type TipoArquivo } from "./tipo-arquivo";

export interface OpcoesArmazenamentoDisco {
  raiz: string;
  maxBytes: number;
  tiposAceitos?: readonly TipoArquivo[];
}

export class ArmazenamentoDisco implements Armazenamento {
  private readonly raiz: string;
  private readonly tiposAceitos: readonly TipoArquivo[];

  constructor(private readonly opcoes: OpcoesArmazenamentoDisco) {
    this.raiz = resolve(opcoes.raiz);
    this.tiposAceitos = opcoes.tiposAceitos ?? ["jpeg", "png", "xml", "csv", "xlsx"];
  }

  async salvar(comercianteId: string, conteudo: Buffer): Promise<ArquivoSalvo> {
    // O id vira nome de pasta: só UUID, para nunca escapar da raiz.
    if (!ehUuid(comercianteId)) throw new Error("comerciante_id inválido para o armazenamento");
    if (conteudo.length === 0) throw new ErroArmazenamento("vazio", "Arquivo vazio");
    if (conteudo.length > this.opcoes.maxBytes) {
      throw new ErroArmazenamento(
        "grande_demais",
        `Arquivo acima do limite de ${this.opcoes.maxBytes} bytes`,
      );
    }
    const tipo = detectarTipo(conteudo);
    if (!tipo || !this.tiposAceitos.includes(tipo)) {
      throw new ErroArmazenamento("tipo_nao_aceito", "Tipo de arquivo não aceito");
    }

    const hash = createHash("sha256").update(conteudo).digest("hex");
    const caminho = `${comercianteId.toLowerCase()}/${hash}.${EXTENSAO[tipo]}`;
    const destino = this.absoluto(caminho);
    // Mesmo conteúdo, mesmo caminho: reenviar o arquivo não grava duas vezes.
    if (!(await existe(destino))) {
      await mkdir(dirname(destino), { recursive: true });
      const temporario = `${destino}.${randomUUID()}.tmp`;
      await writeFile(temporario, conteudo);
      await rename(temporario, destino);
    }
    return { caminho, hash, bytes: conteudo.length, tipo };
  }

  async ler(caminho: string): Promise<Buffer> {
    return readFile(this.absoluto(caminho));
  }

  async remover(caminho: string): Promise<void> {
    await rm(this.absoluto(caminho), { force: true });
  }

  async removerDoComerciante(comercianteId: string): Promise<void> {
    if (!ehUuid(comercianteId)) throw new Error("comerciante_id inválido para o armazenamento");
    await rm(this.absoluto(comercianteId.toLowerCase()), { recursive: true, force: true });
  }

  private absoluto(caminho: string): string {
    const completo = resolve(this.raiz, caminho);
    const rel = relative(this.raiz, completo);
    if (rel.startsWith("..") || rel.split(sep).includes(".."))
      throw new Error("Caminho fora do armazenamento");
    return completo;
  }
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}
