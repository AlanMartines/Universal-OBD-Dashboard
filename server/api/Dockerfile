# Base presa por digest; o Dependabot propõe a troca toda semana.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# O npm só serve para instalar: sai da imagem final, junto com as falhas que ele traz.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm
COPY . .
RUN rm -rf test
USER node
EXPOSE 28472
CMD ["node", "src/server.js"]
