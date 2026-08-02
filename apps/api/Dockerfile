FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client curl ca-certificates unzip \
  && curl -fsSL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o /tmp/rclone.zip \
  && unzip /tmp/rclone.zip -d /tmp \
  && cp /tmp/rclone-*-linux-amd64/rclone /usr/local/bin/rclone \
  && chmod +x /usr/local/bin/rclone \
  && curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc \
  && rm -rf /var/lib/apt/lists/* /tmp/rclone*

WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm install --workspace apps/api
COPY apps/api apps/api
RUN npm run build -w apps/api

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["npm", "run", "start"]
