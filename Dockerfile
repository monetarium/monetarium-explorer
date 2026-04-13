# Build stage for the Go backend
FROM golang:1.23-alpine AS backend-builder

RUN apk add --no-cache git

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build
COPY . .
WORKDIR /app/cmd/dcrdata
RUN go build -v -o monetarium-explorer .

# Build stage for the frontend assets
FROM node:24-alpine AS frontend-builder

WORKDIR /app/cmd/dcrdata

# Cache dependencies
COPY cmd/dcrdata/package*.json ./
RUN npm ci

# Copy frontend source and build
COPY cmd/dcrdata/ .
RUN npm run build

# Final runtime stage
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

# Create a non-root user with UID/GID 1000 to avoid permission issues with mounted volumes
RUN addgroup -g 1000 -S explorer && adduser -u 1000 -S explorer -G explorer

WORKDIR /app

# Copy binary and assets from builders
COPY --from=backend-builder /app/cmd/dcrdata/monetarium-explorer .
COPY --from=backend-builder /app/cmd/dcrdata/views ./views
COPY --from=frontend-builder /app/cmd/dcrdata/public ./public

# Use the non-root user
USER explorer

# The default port as per README
EXPOSE 7777

CMD ["./monetarium-explorer"]
