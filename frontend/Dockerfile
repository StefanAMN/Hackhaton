FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy project files
COPY . .

# Expose Vite's default port
EXPOSE 5173

# Start Vite server (configured to listen on all interfaces via host: 0.0.0.0 in vite.config.js)
CMD ["npm", "run", "dev"]
