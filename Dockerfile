FROM node:24.22.2-alpine

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

WORKDIR /app

# Current API uses only Node.js built-ins and native erasable TypeScript.
COPY --chown=node:node api/ ./api/

USER node

EXPOSE 8080
CMD ["node", "api/index.ts"]
