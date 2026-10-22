/**
 * Perguntas da nota na conversa (issue #182). O texto é o que a ingestão montou em código
 * (`revisao/perguntas.ts`); aqui entram os botões ou a lista de produtos, cada opção com o id da
 * pergunta, para a resposta ir direto ao resolvedor estruturado (`responderPergunta`), sem modelo.
 */
import type { LinhaLista, SaidaWhatsapp } from "./formato";
import { LIMITES_META } from "./regras-meta";

export interface PerguntaDaNota {
  id: string;
  tipo: string;
  pergunta: string;
  contexto: unknown;
}

/** Resposta tocada pelo dono: confirma, recusa ou escolhe um produto do cadastro. */
export type RespostaDaNota =
  { perguntaId: string; tipo: "sim" | "nao" } | { perguntaId: string; tipo: "produto"; produtoId: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ACAO = new RegExp(`^pergunta:(${UUID}):(sim|nao|produto:(${UUID}))$`);

export const acaoDaPergunta = (perguntaId: string, resposta: "sim" | "nao" | `produto:${string}`) =>
  `pergunta:${perguntaId}:${resposta}`;

export function lerAcaoDaPergunta(acao: string | null): RespostaDaNota | null {
  const m = acao ? ACAO.exec(acao) : null;
  if (!m) return null;
  if (m[3]) return { perguntaId: m[1]!, tipo: "produto", produtoId: m[3] };
  return { perguntaId: m[1]!, tipo: m[2] as "sim" | "nao" };
}

const cortar = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 1)}…`);

interface ProdutoSugerido {
  produto_id: string;
  nome: string;
}

/** Sugestão do modelo primeiro, depois os candidatos por similaridade, sem repetir produto. */
function sugestoes(contexto: unknown): ProdutoSugerido[] {
  const c = (contexto ?? {}) as { sugestao_modelo?: ProdutoSugerido; candidatos?: ProdutoSugerido[] };
  const todos = [...(c.sugestao_modelo ? [c.sugestao_modelo] : []), ...(c.candidatos ?? [])];
  const vistos = new Set<string>();
  return todos.filter((p) => {
    if (typeof p?.produto_id !== "string" || typeof p.nome !== "string" || vistos.has(p.produto_id))
      return false;
    vistos.add(p.produto_id);
    return true;
  });
}

/** A pergunta como mensagem: botões de sim e não, ou a lista de produtos para o vínculo. */
export function perguntaParaSaida(p: PerguntaDaNota): SaidaWhatsapp {
  if (p.tipo === "confirmar_vinculo") {
    const produtos = sugestoes(p.contexto).slice(0, LIMITES_META.linhasLista - 1);
    const rows: LinhaLista[] = [
      ...produtos.map((s) => ({
        id: acaoDaPergunta(p.id, `produto:${s.produto_id}`),
        title: cortar(s.nome, LIMITES_META.tituloLinha),
        ...(s.nome.length > LIMITES_META.tituloLinha && {
          description: cortar(s.nome, LIMITES_META.descricaoLinha),
        }),
      })),
      { id: acaoDaPergunta(p.id, "nao"), title: "Nenhum desses" },
    ];
    return {
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: p.pergunta },
        action: { button: "Escolher produto", sections: [{ rows }] },
      },
    };
  }
  const nota = p.tipo === "confirmar_documento";
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: p.pergunta },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: acaoDaPergunta(p.id, "sim"), title: nota ? "Sim, está certa" : "Sim, está certo" },
          },
          { type: "reply", reply: { id: acaoDaPergunta(p.id, "nao"), title: nota ? "Vou reenviar" : "Não" } },
        ],
      },
    },
  };
}

export const TEXTO_PERGUNTA_RESOLVIDA = "Anotado, obrigado.";
export const TEXTO_NOTA_CONFERIDA = "Anotado. Com isso a nota ficou conferida.";
export const TEXTO_PERGUNTA_JA_RESPONDIDA = "Essa pergunta já tinha sido respondida.";
export const TEXTO_PERGUNTA_FALHOU =
  "Não consegui registrar essa resposta. Pode tentar de novo daqui a pouco?";
export const TEXTO_REENVIAR_NOTA =
  "Tudo bem. Mande outra foto da nota, inteira e bem iluminada, que eu leio de novo.";
export const TEXTO_SEM_PRODUTO =
  "Tudo bem. Esse item fica sem produto por enquanto, e o custo dele não entra nas margens até ser ligado.";
