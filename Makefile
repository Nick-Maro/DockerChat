compose_file := docker-compose.yml

.PHONY: build up test all

all: build up test

build:
	docker compose -f $(compose_file) build

up:
	docker compose -f $(compose_file) up -d

test:
	@echo "Eseguo i test Bun..."
	cd backend-servers && bun test