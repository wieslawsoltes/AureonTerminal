FROM node:22-bookworm-slim AS verify
WORKDIR /app
COPY package.json ./
COPY . ./
RUN npm run build && npm run check

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 AUREON_DATA_DIR=/var/lib/aureon
COPY --from=verify --chown=node:node /app/package.json /app/server.mjs ./
COPY --from=verify --chown=node:node /app/server ./server
COPY --from=verify --chown=node:node /app/src ./src
COPY --from=verify --chown=node:node /app/dist ./dist
COPY --from=verify --chown=node:node /app/index.html /app/styles.css /app/icon.svg /app/manifest.webmanifest /app/sw.js ./
RUN mkdir -p /var/lib/aureon && chown node:node /var/lib/aureon
USER node
EXPOSE 4173
CMD ["node","server.mjs"]
