FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript (server only)
RUN npm run build:server

# Copy pre-built client files
COPY public ./public

# Remove dev dependencies and source files after build
RUN npm prune --production && \
    rm -rf src tsconfig.json

EXPOSE 3000

CMD ["node", "dist/app.js"]
