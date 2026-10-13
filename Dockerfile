# Staging/prod image: static build served by nginx. Dev runs `npm run dev`
# natively against the apichain-backend compose stack on localhost:8000.
FROM node:25-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# No API URL is baked in: the PWA always calls its own origin (12 D4). Behind
# this image, route /v2 to the API on the same host.
RUN npm run build

FROM nginx:alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
