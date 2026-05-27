.PHONY: test test-frontend test-backend dev-frontend dev-backend generate

test: test-backend test-frontend

test-backend:
	go test ./...

test-frontend:
	cd frontend && pnpm test

dev-backend:
	go run ./cmd/server

dev-frontend:
	cd frontend && pnpm dev

generate:
	cd frontend && pnpm generate
