# Stage Build 
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage Production
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# ติดตั้ง Library 
COPY package*.json ./
RUN npm install --production

# COPY JS
COPY --from=builder /app/dist ./dist

# Open Port
EXPOSE 5000

# Run Backend
CMD ["node", "dist/index.js"]