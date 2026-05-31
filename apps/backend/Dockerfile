FROM node:lts

WORKDIR /workspace

COPY package*.json ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm install

COPY apps/backend ./apps/backend

WORKDIR /workspace/apps/backend

EXPOSE 3000

CMD ["npm", "run", "dev"]
