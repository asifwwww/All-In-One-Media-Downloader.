FROM node:20-bookworm-slim

# python + ffmpeg (merging), deno (YouTube JS challenges), latest yt-dlp with EJS solver
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ffmpeg ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -U pip "yt-dlp[default]"
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
ENV PATH="/opt/venv/bin:/usr/local/bin:${PATH}"
RUN printf -- "--js-runtimes deno\n" > /etc/yt-dlp.conf

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --omit=optional
COPY index.js ./
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "index.js"]
