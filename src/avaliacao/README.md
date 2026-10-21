# avaliacao

Harness de avaliação do agente (`npm run eval`). Issue #68; os casos de verdade são das issues #69 a #74. Metas e testes por agente: `docs/especificacao-agentes.md`, seção 8.

## Uso

```bash
npm run seed:demo                          # carrega o mercadinho (uma vez)
npm run eval                               # modo falso: modelo roteirizado, sem rede e sem custo
npm run eval -- --modelo real              # API da Anthropic; exige ANTHROPIC_API_KEY
npm run eval -- --caso q01,q33 --prompt v2
```

Sem `ANTHROPIC_API_KEY`, `--modelo real` para antes de tocar no banco, com a mensagem do que falta. A CLI sai com 1 se algum caso falhar (serve de portão na CI) e com 2 em erro de uso.

## O que sai

- `docs/avaliacoes/AAAA-MM-DD-<versao-prompt>-<modelo>.md`: relatório da rodada, versionado no git. No modo falso o sufixo é `falso`, para a rodada da CI não sobrescrever a de um modelo real do mesmo dia. Traz acertos por categoria, falhas com o motivo, custo e latência por execução, modelo e versão do prompt.
- `evidencias/AAAA-MM-DD-eval-<modo>-<hhmmssmmm>.json`: saída bruta (mensagem e chamadas de cada caso). Fica fora do git e nunca é sobrescrita (colisão ganha `-2`, `-3`). O relatório de mesmo dia, prompt e modelo é substituído; o git guarda o anterior.
- Cada execução também entra em `execucao_agente` (e `chamada_ferramenta`) do mercadinho. `npm run seed:demo` limpa.

## Como funciona

| Arquivo | Papel |
| --- | --- |
| `tipos.ts` | `CasoAvaliacao`, `Criterio`, `ResultadoCaso`, `Rodada` |
| `criterios.ts` | Julga um caso lendo a execução registrada: ferramentas esperadas e o critério (`numero_correto`, `bloqueio_verificador`, `sem_resposta`) |
| `runner.ts` | Roda os casos em sequência pelo `AgenteService` e junta o veredito com custo, latência e chamadas |
| `relatorio.ts` | Resumo por categoria, Markdown do relatório e gravação |
| `rodada.ts` | Liga tudo: escolhe o modelo pelo modo, acha o comerciante do seed, monta o agente como o `AgenteModule` monta |
| `modelo-roteirizado.ts` | `ModeloLinguagem` do modo falso (`texto`, `chamar`) |
| `casos/` | Casos. `perguntas.ts` lê `fixtures/avaliacao/perguntas.json`; `exemplos.ts` tem q01 e q33; `index.ts` junta |

Um caso declara: `entrada`, `gatilho`, `ferramentasEsperadas` (todas têm de ser chamadas) e `criterio`. Para o modo falso traz também o `roteiro` do modelo e, se precisar, `ferramentasFalsas`: dublês que ocupam o lugar da ferramenta de mesmo nome do catálogo enquanto o plano A não a entrega. No modo real só vale o catálogo de `montarCatalogo`.

Regras dos critérios:

- Dinheiro do gabarito vem em centavos e a mensagem o escreve em reais (`122151` vira "R$ 1.221,51"). Percentual compara o módulo; o sentido (queda, alta) vem da palavra e ainda não é conferido.
- `bloqueio_verificador`: o número barrado não pode aparecer na mensagem final, e o fallback do verificador não pode ter número.
- `numero_correto` com dois ou mais números da mesma unidade exige `contexto` em cada um (ex.: `/ontem/`, `/28 dias|anteriores/`): sem isso, a resposta com os valores trocados passaria. O contexto é procurado entre o número anterior e o seguinte da mensagem. O harness recusa o caso antes de rodar.
- `sem_resposta`: aprovada, sem nenhum número e dizendo que não sabe ou o que falta. O padrão padrão pede "não sei", "não tenho dados" e variantes; o caso pode declarar `padraoNaoSei` mais específico (o q33 declara).
- Data de referência (`--data` ou do caso) tem de existir no calendário, senão a rodada nem começa.

## Para acrescentar casos (#69 a #74)

Crie `casos/<tema>.ts` exportando uma lista de `CasoAvaliacao` e some-a em `casos/index.ts`. Números esperados saem de `perguntas.json`, nunca digitados à mão. Critério novo (injeção, ação com confirmação, escolha de ferramenta) entra como mais um `tipo` em `criterios.ts`.

## Fora do harness

Não mede o Extrator (#71) nem a escolha dos 3 alertas do relatório (falta o top 3 aceitável no gabarito; ver a seção 8 da especificação).
