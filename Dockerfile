FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY migrations ./migrations
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=8080 DB_PATH=/data/news.db
EXPOSE 8080
CMD ["node", "src/server.js"]
