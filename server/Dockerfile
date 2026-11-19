FROM node:22-alpine
WORKDIR /app
COPY package.json signaling.js ./
RUN npm install --omit=dev
ENV PORT=9000
EXPOSE 9000
CMD ["node", "signaling.js"]
