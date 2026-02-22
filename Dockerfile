FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules/ node_modules/
EXPOSE 4819
ENV CODEHIVE_HOST=0.0.0.0
ENV CODEHIVE_PORT=4819
CMD ["node", "dist/relay/server.js"]
