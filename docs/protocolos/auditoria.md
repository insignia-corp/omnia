# Protocolo: auditoria (pós-edição)

Para qualquer agente, depois de editar código ou docs e antes de abrir PR. Trabalhe só sobre o diff (`git diff` e `git diff --cached`).

1. **Um fato, um dono**: para cada número, regra ou decisão adicionada, procure se já existe em outro lugar (`grep -rn` em `docs/`, `AGENTS.md`, `README.md`). Se existir, deixe no dono (ver `docs/README.md`) e troque a cópia por link.
2. **Duplicata de código**: procure equivalente em `src/lib/` e no módulo vizinho antes de manter função nova. Reuse `dinheiro`, `cnpj` e `verificador-numeros`.
3. **Invariantes** (regras 1 a 12 do `AGENTS.md`), olhando o diff:
   - dinheiro em ponto flutuante ou `parseFloat`;
   - tabela nova sem `comerciante_id`; ferramenta que receba `comerciante_id` fora da sessão;
   - dado gravado sem origem e confiança; saída de modelo sem Zod;
   - estado de negócio em memória do processo;
   - `DELETE` ou `UPDATE` em histórico de custo ou vínculo nota-produto;
   - segredo, chave ou URL com credencial; variável nova sem entrada em `.env.example`;
   - número chegando ao dono sem passar pelo verificador;
   - travessão em texto ou mensagem.
4. **Cobertura**: issue com `regra-inviolável` exige teste que prove a regra.
5. **Portões**: `npm run lint && npx prettier --check . && npm run typecheck && npm test` (mais `npm run test:e2e` se tocou banco, fila ou HTTP, e `npx drizzle-kit check` se tocou `schema.ts`; a CI também roda `npm run build`). Falha de ambiente (dependência ausente): `npm ci` e repetir. Não afirme verde sem ter visto verde.
6. **Corrigir e commitar**: aplique as correções, repita os portões e commite em branch `feature/*`, nunca em `develop` ou `main`. Sem push.
7. **Relatório**: achados (arquivo:linha, regra, o que foi feito) e resultado dos portões. Sem achados: uma linha.
