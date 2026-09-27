FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

ENV PORT=3001 \
    DB_PATH=/data/volna.db
VOLUME /data
EXPOSE 3001

CMD ["npm", "start", "-w", "@volna/server"]
