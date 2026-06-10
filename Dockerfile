FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    SITE_DIR=/app/dist \
    DATA_DIR=/data \
    DATABASE_FILE=/data/xdufood.sqlite
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8080
CMD ["node", "server/site-server.mjs"]
