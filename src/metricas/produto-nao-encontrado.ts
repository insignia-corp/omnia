import { dadoAusente, type DadoAusente } from "./resultado-metrica";

/** O produto pedido não está no cadastro do comerciante da sessão (ou o id não é de um produto dele). */
export const produtoNaoEncontrado = (perguntaSugerida?: string): DadoAusente =>
  dadoAusente("produto_nao_encontrado", "Não encontrei esse produto no seu cadastro.", perguntaSugerida);
