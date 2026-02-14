FROM node:18-slim

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

COPY . .

ENV PATCHRIGHT_BROWSERS_PATH=/usr/local/share/patchright

# Install Playwright dependencies
RUN npx patchright install chromium --with-deps

RUN npm run build

ARG PORT
ENV PORT=${PORT}

EXPOSE ${PORT}

CMD [ "npm", "start" ]
