FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Releases ship the local VCS metadata folder under its storage name;
# restore it where the runtime expects it.
RUN cp -r src/public/vcs-metadata src/public/.git && \
    mkdir -p /app/logs /app/src/public/uploads && \
    chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=9000

USER node

EXPOSE 9000

CMD ["node", "src/server.js"]
