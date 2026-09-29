FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

# «Сегодня» для расчёта сроков — по Москве, а не по UTC хостинга.
ENV NODE_ENV=production \
    TZ=Europe/Moscow \
    PORT=3001 \
    DB_PATH=/data/volna.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3001

USER node
CMD ["npm", "start", "-w", "@volna/server"]
