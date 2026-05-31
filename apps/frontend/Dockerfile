FROM node:lts AS build

WORKDIR /workspace

COPY package*.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN npm install

COPY apps/frontend ./apps/frontend

WORKDIR /workspace/apps/frontend

ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:stable-alpine

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80
