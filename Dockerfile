FROM node:10.15.1-alpine
WORKDIR /usr/src/app
COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install
COPY . .
CMD sleep 30s && npm start

EXPOSE 8200
