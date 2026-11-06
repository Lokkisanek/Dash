# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .

# Optional default HA URL hint for the login screen (OAuth happens in the browser).
# Leave empty so users enter their HA URL on first visit.
ARG VITE_HA_URL=
ARG VITE_MODE=
ENV VITE_HA_URL=$VITE_HA_URL
ENV VITE_MODE=$VITE_MODE

RUN npm run build

# ── Runtime stage ────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 86

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:86/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
