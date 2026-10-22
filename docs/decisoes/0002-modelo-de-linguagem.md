# 0002 · Modelo de linguagem e loop do agente

Data: 19/10/2026 · Status: aceita · Issue: #48

## Decisão

- **Provedor:** API da Anthropic pelo SDK oficial `@anthropic-ai/sdk`.
- **Modelo padrão:** `claude-sonnet-5-5` (tool use e visão no mesmo modelo), configurável por `LLM_MODELO`. Começou em `claude-opus-5-5`; trocado para o Sonnet em 21/10/2026 por decisão do plano B (o eval do Extrator já roda no Sonnet), e o Opus só volta se o `npm run eval` mostrar ganho. O esforço (`LLM_ESFORCO`) começa em `medium`, que é o padrão do modelo, e deve ser ajustado com a avaliação da Etapa 7.
- **Loop manual** em vez do Tool Runner do SDK: o código precisa controlar cada passo para injetar o `comerciante_id` da sessão, registrar cada chamada de ferramenta e passar o texto final pelo verificador de números antes de qualquer envio.
- **Fallback de recusa:** `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Se um classificador de segurança recusar o pedido, a API refaz no modelo recomendado, na mesma chamada.
- **Cache de prompt** automático (`cache_control` no topo). Ferramentas e prompt de sistema não mudam entre execuções; a data entra na mensagem do usuário, não no prompt de sistema.
- **Histórico só acrescentado:** cada resposta do modelo volta inteira para a conversa e a correção do verificador entra como nova mensagem. Não editamos mensagens anteriores.

## Custo

O preço por token fica em `src/agente/llm/modelo-linguagem.ts` e o custo estimado de cada execução é gravado em `execucao_agente.custo_estimado_microdolares`. Reconfirmar os preços antes do pitch.

## Em aberto

Comparar custo e latência com um modelo menor (por exemplo `claude-sonnet-5-5`) usando `npm run eval`, quando a avaliação existir.
