FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY web ./web
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_FILE=/data/state.json
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server/index.js"]
