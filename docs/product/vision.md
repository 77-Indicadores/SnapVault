# Visao do Produto

## Problema

Muitos ambientes self-hosted dependem de scripts manuais, cron jobs sem visibilidade, copias inconsistentes ou ferramentas complexas demais para tarefas simples de backup.

SnapVault resolve esse problema com uma interface unica para configurar, executar, acompanhar e restaurar backups de PostgreSQL e MinIO.

## Publico-alvo

- Desenvolvedores que mantem servidores proprios.
- Pequenas empresas com apps self-hosted.
- Times que usam PostgreSQL e MinIO em VPS, bare metal, Docker ou homelab.
- Consultorias que precisam padronizar backup para clientes.

## Proposta

SnapVault deve ser:

- Facil de instalar com Docker Compose.
- Seguro por padrao.
- Transparente sobre o que foi salvo, quando, onde e com qual resultado.
- Extensivel para novos destinos.
- Intuitivo o suficiente para configurar sem ler um manual inteiro.

## Fora de escopo inicial

- Backup completo de maquinas ou discos.
- Cluster manager para PostgreSQL.
- Substituir solucoes enterprise de disaster recovery.
- Multi-tenant SaaS.
- Backup de Microsoft 365 como fonte. OneDrive e SharePoint sao destinos no MVP.

## Metricas de sucesso

- Primeiro backup configurado em menos de 10 minutos.
- Falhas de backup claramente visiveis no dashboard.
- Restore testavel pelo usuario.
- Adicao de novo destino sem alterar o core de jobs.
