FROM jarredsumner/bun:edge

WORKDIR /app
COPY . .

RUN bun install

CMD ["bun", "run", "index.ts"]