# Use the official Apify Node.js image with Playwright and Chrome
FROM apify/actor-node-playwright-chrome:22

# Copy package.json and package-lock.json first for better Docker layer caching
COPY package*.json ./

# Install NPM packages
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && npm list --omit=dev --all || true \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy the rest of the application
COPY . ./

# Set the default command to run the application
CMD ["npm", "start"]