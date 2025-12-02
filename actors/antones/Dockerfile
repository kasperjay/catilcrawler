FROM apify/actor-node-playwright:20

# Playwright browsers are pre-installed in this base image.
USER root
WORKDIR /usr/src/app

# Copy only manifest first for layer caching.
COPY package.json ./

# Use npm install (no package-lock in isolated actor workspace due to monorepo root lock).
RUN npm install --omit=dev --no-audit --no-fund

# Copy remaining source.
COPY . .

CMD ["node", "src/main.js"]
