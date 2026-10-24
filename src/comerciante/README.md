# comerciante

Sessão do comerciante (regra inviolável 3). O módulo tem só `sessao.ts`: o `SessaoGuard` resolve quem está chamando e `@ComercianteDaSessao()` entrega o id ao serviço. Cadastro e consentimento do lojista ainda não têm fluxo próprio (as tabelas `comerciante` e `consentimento` estão em `src/infra/database/schema.ts`). Issues: #21, #83, #85.

- Identidade nas rotas HTTP: cabeçalho `X-Comerciante-Id`, conferido no banco; sem um id válido que exista, responde 401. Provisório, até o canal autenticar o dono.
- `/whatsapp` e o link do `/painel` levam o id em `?comerciante=`, também provisório. Sem o parâmetro, `/whatsapp` usa o comerciante do seed da demo.
- Usado pelas rotas de chat web, bastidores, painel, ingestão (notas, planilhas, perguntas) e execuções do agente.
- O `comerciante_id` das ferramentas do agente vem da sessão (`contexto.comercianteId`), nunca do modelo: o registro de ferramentas recusa `comerciante_id` na entrada.
