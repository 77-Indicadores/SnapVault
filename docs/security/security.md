# Seguranca

## Principios

- Seguro por padrao.
- Secrets nunca aparecem no frontend.
- Backups podem ser criptografados antes de sair do servidor.
- Logs sao uteis, mas sanitizados.
- Restore destrutivo exige confirmacao forte.

## Autenticacao

- Primeiro acesso cria o admin.
- Senhas com Argon2id ou bcrypt.
- Cookies HTTP-only.
- Protecao CSRF se usar cookies em browser.
- Rate limit no login.

## Segredos

Segredos incluem:

- Senhas PostgreSQL.
- Access keys MinIO.
- Tokens rclone.
- Chaves de criptografia.

Armazenamento:

- Criptografar segredos no banco interno.
- Usar uma master key local via env var: `SNAPVAULT_SECRET_KEY`.
- Se a env var nao existir em producao, o app deve recusar iniciar.

## Criptografia de backups

MVP:

- Criptografia opcional por politica.
- Chave derivada de segredo local ou chave configurada.

Futuro:

- Chaves por politica.
- Rotacao de chaves.
- Integracao com KMS.

## Permissoes

Roles planejadas:

- `admin`: tudo.
- `operator`: gerencia backups e restores.
- `viewer`: apenas leitura.

MVP:

- Implementar apenas admin, mantendo o modelo preparado.

## Auditoria

Eventos auditaveis:

- Login.
- Logout.
- Criacao/edicao/remocao de fonte.
- Criacao/edicao/remocao de destino.
- Criacao/edicao/remocao de politica.
- Execucao manual.
- Preparacao de restore.
- Alteracao de configuracoes de seguranca.

## Sanitizacao de logs

Devem ser mascarados:

- Passwords.
- Tokens.
- Access keys.
- Secret keys.
- URLs com credenciais.

Formato:

```txt
postgres://user:***@host:5432/db
```

## Ameacas consideradas

- Roubo de credenciais cloud.
- Exposicao de dump PostgreSQL no staging.
- Logs contendo segredos.
- Usuario dispara restore incorreto.
- Destino cloud indisponivel.
- Ataque por tentativa de login.

## Controles minimos

- Hash forte de senha.
- Secrets criptografados.
- Backup encryption.
- HTTPS recomendado via reverse proxy.
- Rate limiting.
- Auditoria.
- Validacao de paths para evitar escrita fora do staging.
