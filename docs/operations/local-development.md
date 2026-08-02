# Desenvolvimento Local

## Docker Desktop

O desenvolvimento e os testes locais devem assumir Docker Desktop disponivel.

Uso esperado:

- Subir dependencias de desenvolvimento via Docker Compose.
- Testar PostgreSQL real em container.
- Testar MinIO real em container.
- Testar API, worker e web app em containers.
- Validar fluxos de backup e restore em volumes locais.

## Variaveis de ambiente

Credenciais reais devem ficar apenas em `.env`.

O repositorio fornece `.env.example` sem valores sensiveis.

Variaveis Microsoft usadas para testes OneDrive/SharePoint:

```env
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT_ID=
```

## Regra de seguranca

Arquivos `.env` e `.env.*` nao devem ser commitados.

Se uma credencial for exposta por engano em commit, ela deve ser rotacionada imediatamente no provedor.

## Pasta de testes

O projeto deve reservar volumes locais para execucoes de desenvolvimento:

```txt
data/
staging/
tmp/
```

Essas pastas sao ignoradas pelo Git.
