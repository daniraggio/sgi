FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node . .
ENV PORT=4173 HOST=0.0.0.0
EXPOSE 4173
USER node
CMD ["node","server/index.mjs"]
