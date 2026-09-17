# 웹(Next.js)과 워커를 같은 이미지로 빌드하고, 실행 명령만 다르게 한다.
FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# prisma generate 는 build 스크립트에 포함되어 있다.
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY public ./public
COPY prisma ./prisma
COPY src ./src
COPY package.json tsconfig.json next.config.ts postcss.config.mjs ./

EXPOSE 3000
# 기본은 웹 서버. 워커는 docker-compose 에서 command 를 덮어쓴다.
CMD ["npm", "run", "start"]
