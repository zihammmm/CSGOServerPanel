FROM golang:1.24-alpine AS builder
WORKDIR /app
ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server .

FROM alpine:3.21
WORKDIR /app
COPY --from=builder /out/server /app/server
EXPOSE 8080
CMD ["/app/server"]
