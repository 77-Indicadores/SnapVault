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
10. Aplicar retencao.
11. Limpar staging.
12. Atualizar status.

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

Limites:

- Sem PITR no MVP.
- Sem backup incremental nativo no MVP.
- Restore inicial gera arquivo e comando recomendado.

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

## Restore

### PostgreSQL

MVP:

- Baixar artefato.
- Validar checksum.
- Descriptografar e descomprimir quando necessario.
- Entregar caminho local e comando sugerido:

```bash
psql "$DATABASE_URL" < dump.sql
```

### MinIO

MVP:

- Baixar artefato.
- Validar checksum.
- Extrair para diretorio local.
- Opcionalmente enviar para bucket/prefixo alternativo.

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
