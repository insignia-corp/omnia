# Custo e tempo por execução: claude-sonnet-5-5

| | |
| --- | --- |
| Rodada | 2026-10-22T02:22:12.020Z |
| Modelo do Analista | claude-sonnet-5-5 (prompt sistema-v3) |
| Modelo do Extrator | claude-sonnet-5-5 (prompt extrator-v1) |
| Fonte do agente | `evidencias/2026-10-22-eval-real-021522461.json` |
| Fonte da extração | `../omnia/evidencias/2026-10-21-eval-extracao-real-220730340.json` |
| Gerado por | `npm run eval:custo` |

## Custo e tempo por execução

| Execução | Amostras | Sem aprovação do verificador | Custo médio | Tempo p50 | Tempo p95 | Tempo máximo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Relatório diário | 5 | 0 | US$ 0,0144 | 6,6 s | 7,2 s | 7,2 s |
| Pergunta do dono (conversa) | 50 | 11 | US$ 0,0218 | 6,8 s | 13,3 s | 16,7 s |
| Extração de nota | 17 | 0 | US$ 0,0092 | 3,7 s | 6,1 s | 6,1 s |

Execução sem aprovação do verificador terminou em regeração e fallback: custo e tempo dela entram na média e nos percentis, porque é o que o dono espera de custo e de espera no pior caso. Percentis pelo posto mais próximo, sem interpolar. Custo estimado a partir dos tokens e do preço por modelo em `src/agente/llm/modelo-linguagem.ts`.

## Tempo de resposta

Pergunta do dono: p50 de 6,8 s e p95 de 13,3 s; a meta é p95 em até 20,0 s: **atingida**.

## Custo mensal por lojista

Premissas: 30 relatórios, 10 perguntas e 14 notas por mês, 40 mensagens enviadas, 1 lojista dividindo o agregador. Mudam com as flags da CLI.

| Componente | Por mês | Custo unitário | Custo no mês |
| --- | ---: | ---: | ---: |
| Relatório diário | 30 | US$ 0,0144 | US$ 0,4311 |
| Pergunta do dono | 10 | US$ 0,0218 | US$ 0,2177 |
| Extração de nota | 14 | US$ 0,0092 | US$ 0,1281 |
| **LLM, total** | | | **US$ 0,7769** |
| Mensagens do canal | 40 | sem cotação | sem cotação |
| Agregador (dividido por 1 lojista) | 1 | sem cotação | sem cotação |
| **Total dos componentes com valor** | | | **US$ 0,7769** |

Sem valor nesta rodada: mensagens do canal; agregador. O total acima não os inclui. Informe-os com `--mensagem-usd` e `--agregador-usd-mes` (o agregador é cotação pendente: ver `docs/contexto-hackathon.md`).
