/**
 * Modelos (templates) como seriam aprovados na Meta. Fora da janela de 24 h a empresa só pode
 * começar conversa com um destes. O conteúdo fixo mora aqui; os números chegam como parâmetros
 * (`{{n}}`), calculados pelo backend (regra inviolável 1).
 */
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
  nota_lida: {
    categoria: "UTILITY",
    idioma: "pt_BR",
    cabecalho: "Nota lida",
    corpo: "Terminei de ler a nota de {{1}}: {{2}} itens, total de *{{3}}*.",
    rodape: "Omnia, seu gestor no WhatsApp",
    botoes: ["Ver detalhes"],
  },
};

/**
 * Preenche o corpo do modelo com os parâmetros do componente `body`.
 * @param {{ name: string, components?: object[] }} template
 */
export function preencherModelo(template) {
  const modelo = MODELOS[template.name];
  if (!modelo) return null;
  const params = template.components?.find((c) => c.type === "body")?.parameters ?? [];
  const corpo = modelo.corpo.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1]?.text ?? `{{${n}}}`);
  const botoes = modelo.botoes.map((titulo, i) => {
    const comp = template.components?.find((c) => c.type === "button" && Number(c.index) === i);
    return { id: comp?.parameters?.[0]?.payload ?? titulo, title: titulo };
  });
  return { ...modelo, corpo, botoes };
}
