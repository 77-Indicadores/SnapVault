# Especificacao de UX

## Direcao visual

Interface limpa, direta e slim, inspirada na clareza operacional de produtos como Vercel.

Caracteristicas:

- Fundo claro.
- Alto contraste.
- Sidebar estreita.
- Tipografia simples.
- Poucos efeitos.
- Cards pequenos apenas para informacoes repetidas ou status.
- Sem telas promocionais depois do onboarding.

## Rotas

- `/setup`: primeiro acesso.
- `/login`: login.
- `/dashboard`: visao geral.
- `/sources`: fontes.
- `/destinations`: destinos.
- `/policies`: politicas.
- `/runs`: historico de execucoes.
- `/restores`: restore.
- `/settings`: configuracoes.

## Dashboard

Deve responder rapidamente:

- O sistema esta protegido?
- Qual foi o ultimo backup?
- Quando sera o proximo backup?
- Alguma fonte esta falhando?
- Algum destino esta desconectado?

Estados globais:

- `healthy`: todos os backups recentes tiveram sucesso.
- `warning`: algum backup esta atrasado ou nunca rodou.
- `failed`: ultima execucao de uma politica ativa falhou.

## Onboarding

Fluxo em 4 passos:

1. Criar administrador.
2. Adicionar primeira fonte.
3. Conectar primeiro destino.
4. Criar primeira politica.

O usuario pode pular passos 2 a 4, mas o dashboard deve mostrar pendencias claras.

## Linguagem

Textos devem ser curtos e operacionais.

Exemplos:

- "Ultimo backup"
- "Executar agora"
- "Testar conexao"
- "Destino conectado"
- "Falha na autenticacao"
- "Restore preparado"

Evitar texto explicativo longo dentro da interface.
