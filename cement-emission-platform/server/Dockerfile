# 后端服务镜像
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

COPY src ./src

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# 启动时自动等待数据库、执行建表与演示数据初始化
CMD ["node", "src/index.js"]
