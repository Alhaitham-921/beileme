FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node src/data ./src/data
COPY --chown=node:node third_party ./third_party
RUN mkdir -p server/data/wordlists && chown -R node:node server/data
USER node
EXPOSE 3002
CMD ["sh", "-c", "node server/src/db/migrate.js && exec node server/src/server.js"]
