import type { BloqueioVerificador } from "../../agente/execucao/registro-execucoes";

/** Candidato a alerta e o que se decidiu dele. Quem grava é o motor de alertas (plano A) e o agente (plano B). */
export interface DecisaoAlerta {
  alerta_id: string;
  tipo: string;
  prioridade: number;
  status: "candidato" | "enviado" | "descartado" | "obsoleto";
  data_referencia: string;
  chave: string;
  metricas_apoio: unknown;
  justificativa: string | null;
  execucao_id: string | null;
}

export interface ChamadaBastidores {
  ordem: number;
  ferramenta: string;
  entrada: unknown;
  saida: unknown;
  erro: string | null;
  menor_confianca: number | null;
  latencia_ms: number;
}

export interface ExecucaoBastidores {
  id: string;
  gatilho: string;
  criada_em: Date;
  modelo: string;
  versao_prompt: string;
  resultado: string;
  iteracoes: number;
  entrada: string;
  mensagem_final: string;
  erro: string | null;
  latencia_ms: number;
  tokens: { entrada: number; saida: number; cache_leitura: number };
  custo_microdolares: number;
  verificador: { bloqueios: number; tentativas: BloqueioVerificador[] };
  chamadas: ChamadaBastidores[];
  decisoes_alerta: DecisaoAlerta[];
}

export interface ItemBastidores {
  ordem: number;
  descricao_nota: string;
  quantidade: number;
  unidade: string;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
  confianca: number;
  abaixo_do_limite: boolean;
  revisao_pendente: boolean;
  produto: { id: string; nome: string } | null;
}

export interface NotaBastidores {
  documento_id: string;
  tipo: string;
  status_extracao: string;
  confianca_media: number | null;
  motivos_validacao: unknown;
  erro: string | null;
  criada_em: Date;
  processada_em: Date | null;
  fornecedor: { nome: string; cnpj: string | null } | null;
  total_centavos: number | null;
  soma_itens_centavos: number | null;
  limite_confianca: number;
  itens: ItemBastidores[];
}

/** Soma do dia local do comerciante, calculada no banco sobre todas as execuções do dia (não só as listadas). */
export interface ResumoDoDia {
  /** Data local "AAAA-MM-DD" (FUSO_HORARIO) a que os números se referem. */
  data: string;
  execucoes: number;
  bloqueios_verificador: number;
  custo_microdolares: number;
  /** Média em ms, inteira; `null` sem execuções no dia. */
  latencia_media_ms: number | null;
}

export interface PainelBastidores {
  /** Muda quando algo novo chega; a página só redesenha quando muda. */
  versao: string;
  /** Nome do comércio da sessão, para a página mostrar no seletor. */
  comerciante: { nome: string };
  /** Limite de confiança de item (LIMITE_CONFIANCA_ITEM): a tela pinta de âmbar o que fica abaixo. */
  limite_confianca: number;
  resumo_do_dia: ResumoDoDia;
  execucoes: ExecucaoBastidores[];
  ultima_nota: NotaBastidores | null;
  decisoes_sem_execucao: DecisaoAlerta[];
}
