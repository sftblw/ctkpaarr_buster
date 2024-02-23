ctkpaarr spam buster with ChatGPT API

Q. What is cktpaarr?
A. it is a recent broad spam on fediverse. It's useless and meaningless.

## how it works

1. a mention arrives
2. "system"     hey chatgpt, your mission is detecting a spam. (blah blah)
3. "user"       see this: content + OCR result. reason about it.
4. "assistant"  oh it is a spam because...
5. "user"       spam or ham? in one word.
6. "assistant"  spam
7. (suspends a user)

## howto

configure by copying `.env.example` into `.env`. You'll need these.

- Misskey API Key (for `i` auth)
- Misskey Bearer API key (for suspend, extract it from the browser request)
- OpenAI API Key

```
cp .env.example .env
nano .env
```

run

```
pnpm install
pnpm run start
```

if you want use docker-compose

```
docker-compose up -d --build
# OR if your docker is newer version
docker compose up -d --build
```