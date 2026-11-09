FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend backend
COPY database database
RUN npm run build -w backend
ENV NODE_ENV=production PORT=3010
EXPOSE 3010
CMD ["node","backend/dist/server.js"]
