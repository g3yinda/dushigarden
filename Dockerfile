FROM node:24-alpine
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY web ./web
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_FILE=/data/state.json
# CloudRun supplies its outgoing HTTPS proxy CA at runtime; Node reads it on startup.
ENV NODE_EXTRA_CA_CERTS=/app/cert/certificate.crt
# The CloudRun open-API sidecar supplies credentials; whitelist /wxa/msg_sec_check.
# On a self-hosted server, override this with WX_CONTENT_SECURITY_MODE=access_token.
ENV WX_CONTENT_SECURITY_MODE=cloudrun
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server/index.js"]
