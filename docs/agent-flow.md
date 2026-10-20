# Fluxo do agente

Entregável obrigatório do edital (inputs, lógica e outputs). Atualize junto com o código. Estado atual: núcleo do agente pronto; as ferramentas de dados entram com as métricas (issues #50 a #53).

## Visão geral

```
gatilho ──▶ AgenteService.executar
              │
              ├─ monta a entrada (dado delimitado: <mensagem_do_dono>, <conteudo_de_documento>)
              │
              └─ loop (até AGENTE_MAX_ITERACOES)
                   ├─ modelo.gerar(system, messages, tools)
                   ├─ stop_reason = tool_use  ─▶ RegistroFerramentas.executar (em paralelo)
                   │                              · valida entrada com Zod
                   │                              · comerciante_id vem da sessão
                   │                              · resultado alimenta os números autorizados
                   ├─ stop_reason = end_turn  ─▶ verificador de números
                   │                              · aprovado: mensagem pronta
                   │                              · bloqueado: pede correção (até AGENTE_MAX_REGERACOES)
                   │                              · esgotou: fallback sem números
                   ├─ refusal                 ─▶ fallback de recusa
                   └─ erro, timeout, limite   ─▶ fallback de erro
              │
              └─ grava execucao_agente + chamada_ferramenta ──▶ canal (MessageChannel)
```

## Inputs

| Gatilho | Origem | Entrada |
| --- | --- | --- |
| `mensagem_dono` | Chat web ou WhatsApp | Texto do dono, delimitado como dado |
| `relatorio_diario` | Job diário (BullMQ) | Pedido de relatório com até 3 alertas |
| `nota_processada` | Fim da extração de uma nota | Resumo da nota, delimitado como dado |

O `ContextoSessao` (comerciante, nome do comércio, data de referência) é montado pelo código a partir de quem está falando. O modelo nunca o escolhe.

## Lógica

- **Ferramentas** (`src/agente/ferramentas`): cada uma declara nome, descrição, esquema Zod estrito e efeito (`nenhum`, `pergunta_dono`, `escreve_config`). O registro recusa ferramenta que receba `comerciante_id` do modelo. Erro de ferramenta volta ao modelo como `tool_result` com `is_error`, sem derrubar o fluxo.
- **Contrato de retorno** (`src/metricas/resultado-metrica.ts`): valor, período, número de registros e menor confiança. Dinheiro em chaves `*_centavos`, percentuais prontos para exibir em `*_percentual`. Dado ausente é explícito (`{ ausente: true, motivo }`).
- **Verificador de números** (`src/lib/verificador-numeros`): extrai números da mensagem em português ("R$ 1.234,50", "-12,5%", "15/10") e confere com os resultados das ferramentas daquela execução, os números escritos pelo dono e a data de referência. A comparação preserva o sinal e não arredonda. Cardinais por extenso detectados (como "quinhentos reais" e "trinta por cento") são bloqueados mesmo quando o valor existe nas fontes; a correção pede algarismos antes de validar novamente. "Um/uma" são tratados como numerais quando isolados ou acompanhados de unidades/contagens do domínio, preservando artigos em frases como "mande uma planilha".
- **Prompt de sistema** versionado em `src/agente/prompts/sistema-v1.md`; a versão é gravada em cada execução.

## Outputs

- Mensagem para o canal: aprovada pelo verificador ou um fallback sem números.
- Registro em `execucao_agente`: gatilho, entrada, modelo, versão do prompt, resultado (`aprovada`, `fallback_verificador`, `fallback_erro`, `recusa_modelo`), iterações, bloqueios do verificador com os números barrados, tokens, custo estimado, latência e erro.
- Registro em `chamada_ferramenta`: cada chamada em ordem, com entrada, saída, erro, menor confiança e latência. Base da tela de bastidores.

## Onde fica o estado

PostgreSQL (dados, histórico e execuções) e Redis/BullMQ (filas e jobs). Nada em memória do processo.

## Métrica de degradação

Taxa de bloqueio do verificador: `bloqueios_verificador > 0` sobre o total de execuções, por dia.
