# API と worker で同じイメージを使う。起動のコマンドだけが違う:
#   API:    node api/index.ts（既定）
#   worker: node worker/index.ts（Cloud Run の command で上書きする）
# サーバーのコードはビルドしない。Node.js が .ts を直接実行する。

# --- 本番用の依存だけを入れる ---
FROM node:24.22.2-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --- 実行用のイメージ ---
FROM node:24.22.2-alpine

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node --from=deps /app/node_modules ./node_modules

# 実行に要るファイルだけを入れる。layout.json・dist・docs・eval/bench などは .dockerignore で除く。
COPY --chown=node:node api/ ./api/
COPY --chown=node:node core/ ./core/
COPY --chown=node:node db/ ./db/
COPY --chown=node:node worker/ ./worker/
COPY --chown=node:node forms/index.ts ./forms/index.ts
COPY --chown=node:node forms/templates/ ./forms/templates/
COPY --chown=node:node forms/scripts/layout.mjs forms/scripts/forms.mjs ./forms/scripts/
COPY --chown=node:node forms/fonts/ ./forms/fonts/
# db/seed.ts（demo 環境の見本のデータ）が読む架空の利用者
COPY --chown=node:node forms/samples/ ./forms/samples/
# AI_PROVIDER=fake のときに worker が読む公開の演習シナリオ（db/seed.ts も使う）
COPY --chown=node:node eval/scenario/原本.json ./eval/scenario/原本.json
COPY --chown=node:node eval/scenario/gold/用紙/ ./eval/scenario/gold/用紙/

USER node

EXPOSE 8080
CMD ["node", "api/index.ts"]
