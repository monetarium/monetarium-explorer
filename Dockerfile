FROM golang:1.25 as daemon

COPY . /go/src
WORKDIR /go/src/cmd/dcrdata
RUN go build -v -o monetarium-explorer

FROM node:lts as gui

WORKDIR /root
COPY ./cmd/dcrdata /root
RUN npm install
RUN npm run build

FROM golang:1.25
WORKDIR /
COPY --from=daemon /go/src/cmd/dcrdata/monetarium-explorer /monetarium-explorer
COPY --from=daemon /go/src/cmd/dcrdata/views /views
COPY --from=gui /root/public /public

EXPOSE 9508
CMD [ "/monetarium-explorer" ]
