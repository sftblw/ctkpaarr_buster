# 사용할 Alpine Linux 베이스 이미지를 지정합니다.
FROM node:21-alpine3.18

RUN apk update && \
    apk add --no-cache vips libc6-compat python3 make gcc && \
    rm -rf /var/cache/apk/*

# corepack 활성화
RUN corepack enable pnpm

# 작업 디렉토리를 설정합니다.
WORKDIR /app

# package.json 및 pnpm-lock.yaml 파일을 /app 디렉토리에 복사합니다.
COPY package.json pnpm-lock.yaml ./

# 의존성 설치
RUN pnpm i

# 프로젝트 파일을 컨테이너의 /app 디렉토리에 복사합니다.
COPY src src

# spam_doc.txt 파일을 /app 디렉토리에 복사합니다.
COPY spam_doc.txt ./

# 애플리케이션 실행
CMD ["pnpm", "start"]
