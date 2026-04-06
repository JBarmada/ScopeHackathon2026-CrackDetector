# Node runtime for the Express API + static frontend host.
FROM node:20-alpine

# Keep all server code under /app in the container.
WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev

# Copy source after dependency install so code-only changes are fast to rebuild.
COPY . .

# Expose the HTTP port used by server.js.
EXPOSE 3000

# Start the Express server.
CMD ["node", "server.js"]
