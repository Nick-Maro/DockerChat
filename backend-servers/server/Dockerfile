#if there are problem with libraries change alpine to slim
FROM oven/bun:alpine 
WORKDIR /app
#RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/* (thats for slim)
RUN apk update && apk add --no-cache curl

COPY package.json bun.lock ./
RUN bun install

COPY . .

CMD ["bun", "run", "index.ts"]