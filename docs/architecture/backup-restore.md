# Backup e Restore

## Pipeline de backup

1. Validar politica.
2. Criar `BackupRun`.
3. Reservar diretorio de staging.
4. Executar adapter da fonte.
5. Gerar manifesto.
6. Comprimir quando aplicavel.
7. Criptografar quando aplicavel.
8. Enviar para destino.
9. Verificar upload quando configurado.
10. Baixar o artefato remoto.
11. Validar checksum do arquivo baixado.
12. Executar teste automatico de restore.
13. Marcar a run como `recoverable` quando o restore temporario passar.
14. Aplicar retencao preservando sempre o ultimo `recoverable`.
15. Limpar staging.
16. Atualizar status.

## Estados da execucao

- `queued`: aguardando execucao.
- `running`: backup em andamento.
- `verified`: artefato gerado, enviado e checksum validado.
- `recoverable`: restore automatico validado.
- `failed`: backup falhou antes de ficar confiavel.
- `restore_failed`: artefato existe, mas o teste automatico de restore falhou.

## Manifesto

Todo backup deve gerar um manifesto JSON.

```json
{
  "schemaVersion": 1,
  "snapvaultVersion": "0.1.0",
  "runId": "run_123",
  "policyId": "policy_123",
  "source": {
    "id": "src_123",
    "type": "postgres",
    "name": "prod-db"
  },
  "createdAt": "2026-08-02T16:00:00Z",
  "artifacts": [
    {
      "kind": "postgres_dump",
      "path": "prod-db/2026/08/02/run_123/dump.sql.gz",
      "sizeBytes": 123456,
      "checksumSha256": "hex-encoded-sha256"
    }
  ]
}
```

## PostgreSQL MVP

Estratégia:

- Usar `pg_dump`.
- Gerar arquivo `.sql`.
- Comprimir com gzip ou zstd.
- Upload para destino.

Formato de nome:

```txt
{basePath}/{sourceName}/{yyyy}/{mm}/{dd}/{runId}/dump.sql.gz
```

Modos:

- `single`: usa `pg_dump` para um database.
- `all`: usa `pg_dumpall` para todos os databases acessiveis pelo usuario.

O database escolhido fica em `policy.sourceScope`, nao na Source. A Source guarda apenas host, porta, usuario e credencial.

Limites:

- Sem PITR no MVP.
- Sem backup incremental nativo no MVP.
- Restore manual executavel exige alvo `single`, para evitar restaurar um dump de cluster sobre ambientes errados.

## PostgreSQL futuro

Adicionar modo `pgbackrest`:

- Full, differential e incremental.
- WAL archiving.
- PITR.
- Verificacao de consistencia.
- Repositorios S3/Azure/GCS.

## MinIO MVP

Estratégia:

- Usar MinIO Client.
- Exportar bucket ou prefixo para staging.
- Compactar e enviar, ou espelhar direto quando seguro.

Modos:

- `snapshot`: copia estado atual para artefato versionado.
- `mirror`: sincroniza bucket/prefixo para destino.

O MVP deve priorizar `snapshot`, pois facilita auditoria e retencao.

O bucket/prefixo escolhido fica em `policy.sourceScope`, nao na Source. A Source guarda apenas endpoint e credenciais.

## Restore

### PostgreSQL

Automatico:

- Baixar artefato.
- Validar checksum.
- Descomprimir.
- Restaurar em banco temporario `snapvault_verify_<runId>`.
- Validar que o restore terminou sem erro.
- Validar presenca de objetos no banco temporario.
- Remover banco temporario.

Manual:

- Escolher uma Source PostgreSQL `healthy` com database unico.
- Escolher o database alvo.
- Baixar artefato do destino.
- Aplicar `gzip -cd artifact | psql ... -d target_database`.

### MinIO

Automatico:

- Baixar artefato.
- Validar checksum.
- Extrair para diretorio local.
- Validar que o pacote abre e contem arquivos.
- Remover diretorio temporario.

Manual:

- Escolher uma Source MinIO `healthy` com bucket unico.
- Escolher o bucket/prefixo alvo.
- Baixar artefato do destino.
- Extrair e copiar para o bucket/prefixo alvo com `mc cp --recursive`.

## Scheduler

O processo da API possui scheduler simples no MVP. A cada minuto ele avalia rotinas `enabled` com `schedule.type` `daily` ou `weekly`, cria uma run `scheduled` e dispara o mesmo pipeline usado pelo botao `Executar agora`.

Horarios sao comparados em UTC no scheduler atual. A UI mostra e envia o horario explicitamente; suporte completo a timezones nomeados fica para uma etapa posterior.

## Retencao

Retencao deve considerar:

- `keepLast`: manter ultimos N backups por politica.
- `keepDays`: manter backups dentro de X dias.

Regra:

- Um backup e removivel apenas se violar ambas as protecoes.

Exemplo:

- `keepLast = 7`
- `keepDays = 30`

Um backup antigo pode ser removido se houver pelo menos 7 backups mais recentes e ele tiver mais de 30 dias.
