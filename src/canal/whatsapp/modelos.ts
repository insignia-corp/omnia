/**
 * Modelos (templates) como seriam aprovados na Meta. Fora da janela de 24 h a empresa só pode começar
 * conversa com um destes. O texto fixo mora aqui e os números chegam como parâmetros (`{{n}}`),
 * calculados por funções determinísticas (regra inviolável 1). O front simulado tem uma cópia em
 * `web/whatsapp/modelos.js` para desenhar a bolha; `modelos.spec.ts` confere que as duas não divergem.
 */
import type { Template } from "./formato";

export interface Modelo {
  categoria: "UTILITY" | "MARKETING";
  idioma: string;
  cabecalho: string;
  corpo: string;
  rodape: string;
  /** Títulos dos botões de resposta rápida, na ordem. */
  botoes: string[];
}

export const MODELOS = {
  resumo_diario: {
    categoria: "UTILITY",
    idioma: "pt_BR",
    cabecalho: "Resumo do dia",
    corpo:
      "Bom dia! Em {{1}}, o *{{2}}* faturou *{{3}}* em {{4}} vendas, {{5}} da média dos 7 dias anteriores.\n\nSeparei {{6}} avisos que merecem sua atenção hoje.",
    rodape: "Omnia, seu gestor no WhatsApp",
    botoes: ["Ver avisos", "Resumo completo", "Agora não"],
  },
} as const satisfies Record<string, Modelo>;

export type NomeModelo = keyof typeof MODELOS;

/** Monta o template com os parâmetros do corpo e o payload de cada botão. */
export function montarTemplate(nome: NomeModelo, parametros: string[], payloads: string[]): Template {
  const modelo = MODELOS[nome];
  const esperados = modelo.corpo.match(/\{\{\d+\}\}/g)?.length ?? 0;
  if (parametros.length !== esperados) {
    throw new Error(`O modelo ${nome} pede ${esperados} parâmetros e recebeu ${parametros.length}`);
  }
  if (payloads.length !== modelo.botoes.length) {
    throw new Error(
      `O modelo ${nome} tem ${modelo.botoes.length} botões e recebeu ${payloads.length} payloads`,
    );
  }
  return {
    name: nome,
    language: { code: modelo.idioma },
    components: [
      { type: "body", parameters: parametros.map((text) => ({ type: "text", text })) },
      ...payloads.map((payload, index) => ({
        type: "button" as const,
        sub_type: "quick_reply" as const,
        index,
        parameters: [{ type: "payload" as const, payload }],
      })),
    ],
  };
}

/** Corpo do modelo com os parâmetros preenchidos (o texto legível guardado em `mensagem.texto`). */
export function corpoDoModelo(t: Template): string {
  const modelo = (MODELOS as Record<string, Modelo>)[t.name];
  if (!modelo) return `Modelo ${t.name}`;
  const corpo = t.components.find((c) => c.type === "body");
  const parametros = corpo?.type === "body" ? corpo.parameters : [];
  return modelo.corpo.replace(
    /\{\{(\d+)\}\}/g,
    (_, n: string) => parametros[Number(n) - 1]?.text ?? `{{${n}}}`,
  );
}
