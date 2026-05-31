FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

EXPOSE 3000

VOLUME ["/app/session", "/app/data", "/app/logs"]

CMD ["node", "dist/index.js"]
