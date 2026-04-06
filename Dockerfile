# Stage Build
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage Production
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Install dependencies strictly from lockfile
COPY package*.json ./
RUN npm ci --only=production

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Open Port
EXPOSE 5000

# Run as non-root user for security
USER node

# Use dumb-init as entrypoint to handle signals
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]