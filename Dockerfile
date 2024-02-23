FROM ubuntu:jammy

FROM ubuntu:jammy

# 패키지 목록 업데이트 및 필수 도구 설치
RUN apt-get update && \
    apt-get install -y curl libvips libc6 python3 make gcc && \
    # NodeSource 저장소 설정 및 Node.js 설치
    curl -fsSL https://deb.nodesource.com/setup_21.x | bash - && \
    apt-get install -y nodejs && \
    # 캐시 제거
    rm -rf /var/lib/apt/lists/*


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
