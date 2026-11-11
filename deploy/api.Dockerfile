FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node src/data ./src/data
COPY --chown=node:node third_party ./third_party
COPY --chown=node:node scripts/seed-ielts.mjs ./scripts/seed-ielts.mjs
RUN mkdir -p server/data/wordlists server/media && chown -R node:node server/data server/media
USER node
EXPOSE 3002
CMD ["sh", "-c", "node server/src/db/migrate.js && exec node server/src/server.js"]
