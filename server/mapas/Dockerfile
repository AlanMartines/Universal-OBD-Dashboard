# Contêiner "mapas": baixa e prepara os mapas pedidos pelo painel. Parte da imagem do OSRM v26.4.0
# (Alpine, já traz osrm-extract, osrm-partition, osrm-customize, tar e os certificados) e recebe o
# Node (o mesmo do painel) e o pmtiles. Sem dependência do npm. Imagens presas pelo digest.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS node
# O pmtiles compilado com um Go atual e com as dependências atualizadas (o binário oficial e as
# dependências da v1.31.2 têm falhas conhecidas, apontadas pelo Trivy). Fonte presa pelo commit. Estático.
FROM golang:1.27-bookworm@sha256:4fa7c968ba93f1635670522dbb01a2c78150443e1385746924566079f36570ea AS pmtiles
ARG PMTILES_COMMIT=a3e4951ea6a0477b784c27c1dcbfd9c130878c5a
RUN git init -q /src && cd /src \
 && git fetch -q --depth 1 https://github.com/protomaps/go-pmtiles "$PMTILES_COMMIT" && git checkout -q FETCH_HEAD \
 && go get github.com/go-jose/go-jose/v4@v4.1.9 go.opentelemetry.io/otel/sdk@v1.47.0 golang.org/x/crypto@v0.59.0 \
      golang.org/x/net@v0.63.0 golang.org/x/text@v0.44.0 google.golang.org/grpc@v1.85.0 \
 && go mod tidy \
 && mkdir /out && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/go-pmtiles .

FROM ghcr.io/project-osrm/osrm-backend:v26.4.0@sha256:d01fa0c7b74cea5ef89565222840e66c7359e0db1d8a2ff59eb62dec1dc6858e
RUN apk upgrade --no-cache
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=pmtiles /out/go-pmtiles /usr/local/bin/pmtiles
# Usuário sem privilégio (uid 1000): as pastas dos mapas no servidor precisam ser dele
# (chown -R 1000:1000 data/maps data/osrm; o README do servidor explica).
RUN adduser -D -H -u 1000 -s /sbin/nologin mapas
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
USER mapas
EXPOSE 28473
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:28473/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.js"]
