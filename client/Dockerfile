# build client
FROM node:20 AS build
WORKDIR /app

# Copio package.json e installo dipendenze
COPY package*.json ./
RUN npm install

# Passo le variabili di build (per Vite)
ARG VITE_API_HOST
ARG VITE_API_PORT
ENV VITE_API_HOST=$VITE_API_HOST
ENV VITE_API_PORT=$VITE_API_PORT

# Copio il resto del codice e buildo
COPY . .
RUN npm run build

# serve con http-server
FROM node:20-alpine AS serve
WORKDIR /app

RUN npm install -g http-server
RUN apk add --no-cache curl

COPY --from=build /app/dist/ /app

EXPOSE 80
CMD ["http-server", "-p", "80", "-c-1"]