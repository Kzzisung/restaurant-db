FROM node:20-alpine
WORKDIR /app
COPY backend/package.json .
RUN npm install
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY init.sql .
EXPOSE 3000
CMD ["node", "backend/index.js"]