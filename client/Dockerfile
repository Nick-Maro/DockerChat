# build client
FROM node:20 AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# build serving with http-server
FROM node:20-alpine AS serve
WORKDIR /app
RUN npm install -g http-server
RUN apk add --no-cache curl
COPY --from=build /app/dist/ /app
EXPOSE 80
CMD ["http-server", "-p", "80", "-c-1"]