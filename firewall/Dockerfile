FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download

COPY firewall.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o firewall firewall.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates wget
WORKDIR /root/

COPY --from=builder /app/firewall .
COPY rules.json ./

EXPOSE 5001

CMD ["./firewall"]
