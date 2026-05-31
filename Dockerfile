FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY prompts ./prompts
COPY config.example.yaml ./

EXPOSE 3000

VOLUME ["/app/session", "/app/data", "/app/logs"]

CMD ["node", "dist/index.js"]
