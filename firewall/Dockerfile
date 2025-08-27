FROM golang:1.21-alpine AS builder
RUN apk add --no-cache git ca-certificates
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY src/ ./src/
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags='-w -s -extldflags "-static"' \
    -a -installsuffix cgo \
    -o firewall ./src/

FROM alpine:3.18
RUN apk add --no-cache wget ca-certificates tzdata curl && \
    mkdir -p /var/log/shared/firewall
WORKDIR /app
COPY --from=builder /app/firewall ./
RUN mkdir -p logs && \
    chmod 777 /var/log/shared/firewall
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5001 || exit 1
CMD ["./firewall"]