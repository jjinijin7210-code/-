FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=4175
EXPOSE 4175

CMD ["node", "server.js"]
