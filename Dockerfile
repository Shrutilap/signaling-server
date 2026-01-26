# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY tsconfig.json ./

# Install all deps (including dev deps)
RUN npm ci

# Copy source
COPY src ./src
COPY public ./public

# Build TypeScript
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy ONLY production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy built code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 8080

CMD ["node", "dist/server.js"]
