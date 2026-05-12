FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN npm ci

COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY packages/ui packages/ui

ARG VITE_AGENT_BASE_URL
ARG VITE_ENABLE_LIVE_VOICE=0
ARG VITE_ENABLE_UI_DEMO_TOOLS=0
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_AGENT_BASE_URL=$VITE_AGENT_BASE_URL
ENV VITE_ENABLE_LIVE_VOICE=$VITE_ENABLE_LIVE_VOICE
ENV VITE_ENABLE_UI_DEMO_TOOLS=$VITE_ENABLE_UI_DEMO_TOOLS
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build --workspace @prosody/web

FROM nginx:1.27-alpine AS runtime

ENV PORT=8080

COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
