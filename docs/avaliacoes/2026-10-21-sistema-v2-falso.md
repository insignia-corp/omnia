# Avaliação do agente: sistema-v2, modelo falso

| | |
| --- | --- |
| Rodada | 2026-10-21T21:22:32.767Z |
| Modo | falso (roteirizado, sem custo) |
| Modelo | falso-roteirizado |
| Versão do prompt | sistema-v2 |
| Comerciante | Mercadinho Vila Nova |
| Data de referência | 2026-10-20 |
| Gerado por | `npm run eval -- --modelo falso` |

## Resultado

**45 de 45 casos passaram (100%).**

Custo estimado da rodada: US$ 0,0000. Latência por execução: média de 2 ms, máxima de 6 ms.

## Acertos por categoria

| Categoria | Acertos | Total | Taxa |
| --- | ---: | ---: | ---: |
| numerica | 32 | 32 | 100% |
| sem_resposta | 8 | 8 | 100% |
| verificador | 5 | 5 | 100% |

## Falhas

Nenhuma falha nesta rodada.

## Custo e latência por execução

| Caso | Categoria | Resultado | Ferramentas | Iterações | Bloqueios | Custo | Latência (ms) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| q01 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 6 |
| q02 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 4 |
| q03 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 2 |
| q04 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 3 |
| q05 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 3 |
| q06 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 4 |
| q07 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 3 |
| q08 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 3 |
| q09 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 2 |
| q10 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 2 |
| q11 (passou) | numerica | aprovada | get_daily_summary | 2 | 0 | US$ 0,0000 | 2 |
| q12 (passou) | numerica | aprovada | list_alert_candidates, get_daily_summary | 3 | 0 | US$ 0,0000 | 3 |
| q13 (passou) | numerica | aprovada | get_top_products | 2 | 0 | US$ 0,0000 | 3 |
| q14 (passou) | numerica | aprovada | get_top_products | 2 | 0 | US$ 0,0000 | 2 |
| q15 (passou) | numerica | aprovada | get_top_products | 2 | 0 | US$ 0,0000 | 2 |
| q16 (passou) | numerica | aprovada | get_top_products | 2 | 0 | US$ 0,0000 | 2 |
| q17 (passou) | numerica | aprovada | get_product_margin | 2 | 0 | US$ 0,0000 | 1 |
| q18 (passou) | numerica | aprovada | get_product_margin | 2 | 0 | US$ 0,0000 | 2 |
| q19 (passou) | numerica | aprovada | get_product_margin | 2 | 0 | US$ 0,0000 | 2 |
| q20 (passou) | numerica | aprovada | get_product_margin | 2 | 0 | US$ 0,0000 | 1 |
| q21 (passou) | numerica | aprovada | get_product_margin | 2 | 0 | US$ 0,0000 | 2 |
| q22 (passou) | numerica | aprovada | get_product_margin | 2 | 0 | US$ 0,0000 | 2 |
| q23 (passou) | numerica | aprovada | get_product_margin | 2 | 0 | US$ 0,0000 | 2 |
| q24 (passou) | numerica | aprovada | get_product_margin | 2 | 0 | US$ 0,0000 | 1 |
| q25 (passou) | numerica | aprovada | get_cost_changes | 2 | 0 | US$ 0,0000 | 2 |
| q26 (passou) | numerica | aprovada | get_cost_changes | 2 | 0 | US$ 0,0000 | 3 |
| q27 (passou) | numerica | aprovada | get_cost_changes, list_alert_candidates | 3 | 0 | US$ 0,0000 | 3 |
| q28 (passou) | numerica | aprovada | get_cost_changes | 2 | 0 | US$ 0,0000 | 2 |
| q29 (passou) | numerica | aprovada | get_product_margin, list_alert_candidates | 3 | 0 | US$ 0,0000 | 3 |
| q30 (passou) | numerica | aprovada | list_alert_candidates | 2 | 0 | US$ 0,0000 | 2 |
| q31 (passou) | numerica | aprovada | list_alert_candidates | 2 | 0 | US$ 0,0000 | 1 |
| q32 (passou) | numerica | aprovada | list_alert_candidates | 2 | 0 | US$ 0,0000 | 1 |
| v01 (passou) | verificador | aprovada | get_daily_summary | 3 | 1 | US$ 0,0000 | 2 |
| v02 (passou) | verificador | fallback_verificador | get_daily_summary | 4 | 3 | US$ 0,0000 | 1 |
| v03 (passou) | verificador | aprovada | get_daily_summary | 3 | 1 | US$ 0,0000 | 2 |
| v04 (passou) | verificador | aprovada | get_daily_summary | 3 | 1 | US$ 0,0000 | 1 |
| v05 (passou) | verificador | aprovada | get_daily_summary | 3 | 1 | US$ 0,0000 | 2 |
| q33 (passou) | sem_resposta | aprovada | nenhuma | 1 | 0 | US$ 0,0000 | 2 |
| q34 (passou) | sem_resposta | aprovada | nenhuma | 1 | 0 | US$ 0,0000 | 2 |
| q35 (passou) | sem_resposta | aprovada | nenhuma | 1 | 0 | US$ 0,0000 | 1 |
| q36 (passou) | sem_resposta | aprovada | nenhuma | 1 | 0 | US$ 0,0000 | 2 |
| q37 (passou) | sem_resposta | aprovada | nenhuma | 1 | 0 | US$ 0,0000 | 2 |
| q38 (passou) | sem_resposta | aprovada | nenhuma | 1 | 0 | US$ 0,0000 | 2 |
| q39 (passou) | sem_resposta | aprovada | nenhuma | 1 | 0 | US$ 0,0000 | 2 |
| q40 (passou) | sem_resposta | aprovada | nenhuma | 1 | 0 | US$ 0,0000 | 2 |
