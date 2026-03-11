FROM node:20-alpine

# Install native build toolchain required by better-sqlite3.
RUN apk add --no-cache python3 make g++

WORKDIR /workspace

# Copy workspace manifests first to maximize layer caching for npm installs.
COPY package*.json ./
COPY @markusse/server/package*.json ./@markusse/server/
COPY @markusse/client/package*.json ./@markusse/client/
COPY @markusse/vs-code-plugins/work-share/shared/package*.json ./@markusse/vs-code-plugins/work-share/shared/

# Install workspace dependencies so the server can resolve the shared package.
RUN npm install

# Copy the files required to build the shared package, server, and bundled dashboard.
COPY @markusse/server ./@markusse/server
COPY @markusse/client ./@markusse/client
COPY @markusse/vs-code-plugins/work-share/shared ./@markusse/vs-code-plugins/work-share/shared

# Remove copied build artifacts so the container always starts from a clean server build.
RUN rm -rf ./@markusse/server/dist

# Build shared types first, then the server and bundled client assets.
RUN npm run build:shared && npm run build:server

WORKDIR /workspace/@markusse/server

EXPOSE 3000

CMD ["node", "dist/app.js"]
