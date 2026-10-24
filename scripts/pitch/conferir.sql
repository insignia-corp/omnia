-- Só leitura. Execute no banco que recebeu seed:pitch.
SELECT data, sum(total_centavos) AS faturamento_centavos, count(*) AS vendas,
       round(avg(total_centavos)) AS ticket_medio_centavos
FROM venda
WHERE data IN ('2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23')
GROUP BY data ORDER BY data;

SELECT CASE WHEN data >= '2026-10-17' THEN '17 a 23/10' ELSE '10 a 16/10' END AS semana,
       sum(total_centavos) AS faturamento_centavos
FROM venda WHERE data BETWEEN '2026-10-10' AND '2026-10-23'
GROUP BY semana ORDER BY semana;

WITH unidades AS (
  SELECT p.nome,
    coalesce(sum(i.quantidade) FILTER (WHERE v.data BETWEEN '2026-10-17' AND '2026-10-23'), 0) AS atual,
    coalesce(sum(i.quantidade) FILTER (WHERE v.data BETWEEN '2026-10-10' AND '2026-10-16'), 0) AS anterior
  FROM produto p
  JOIN item_de_venda i ON i.produto_id = p.id AND i.comerciante_id = p.comerciante_id
  JOIN venda v ON v.id = i.venda_id AND v.comerciante_id = i.comerciante_id
  GROUP BY p.id
)
SELECT *, round((atual - anterior) * 100.0 / nullif(anterior, 0), 2) AS variacao_percentual
FROM unidades ORDER BY atual DESC, nome;

SELECT p.nome, max(v.data) AS ultima_venda
FROM produto p
JOIN item_de_venda i ON i.produto_id = p.id AND i.comerciante_id = p.comerciante_id
JOIN venda v ON v.id = i.venda_id AND v.comerciante_id = i.comerciante_id
WHERE p.sku = 'vinagre' GROUP BY p.id;

SELECT p.nome, h.data, h.custo_unitario_centavos, h.origem, h.confianca
FROM historico_custo h JOIN produto p ON p.id = h.produto_id AND p.comerciante_id = h.comerciante_id
WHERE p.sku IN ('arroz', 'cafe') ORDER BY p.nome, h.data;
