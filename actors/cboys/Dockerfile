# Use the Apify base Node.js image
FROM apify/actor-node:22

# Copy package definition first for better caching
COPY package*.json ./

# Install production dependencies
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && npm list --omit=dev --all || true \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy source files
COPY . ./

# Run the scraper
CMD ["npm", "start"]
