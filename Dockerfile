FROM node:22-bookworm-slim

# python + ffmpeg (merging), deno (YouTube JS challenges), latest yt-dlp with EJS solver
RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 python3-venv ffmpeg ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -U pip "yt-dlp[default]" \
 && /opt/venv/bin/pip install --no-cache-dir "git+https://github.com/tribixbite/yt-dlp-threads.git"
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
ENV PATH="/opt/venv/bin:/usr/local/bin:${PATH}"
RUN printf -- "--js-runtimes deno\n" > /etc/yt-dlp.conf

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional
COPY . .
RUN node check-startup.js --full
ENV NODE_ENV=production
ENV NO_UPDATE=1
EXPOSE 10000
CMD ["npm", "start"]
