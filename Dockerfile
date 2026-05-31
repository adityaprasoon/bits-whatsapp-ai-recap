FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .
RUN npm run build

EXPOSE 3000

VOLUME ["/app/session", "/app/data", "/app/logs"]

CMD ["node", "dist/index.js"]
