# Lumeo's Kindle conversion worker: Calibre (ebook-convert) turning the catalog's EPUBs into
# AZW3, in its own container - never inside a Vercel function.
# Build from the repository root:
#   docker build -f worker/kindle-converter/Dockerfile -t lumeo-kindle-worker .
FROM node:22-bookworm-slim

ARG CALIBRE_VERSION=9.18.0

# What Calibre's Qt needs to run headless (libOpenGL, EGL, xcb-cursor, fonts...), and what its
# official installer needs (python3, wget, xz).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates wget xz-utils python3 \
      libopengl0 libegl1 libgl1 libglx0 libxcb-cursor0 libxkbcommon0 libxkbcommon-x11-0 \
      libfontconfig1 libfreetype6 libnss3 libxcomposite1 libxdamage1 libxrandr2 libxtst6 libxi6 libdbus-1-3 \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Official Calibre install (the installer checks the download's signature), pinned, then a
# check that Qt really loads - a conversion needs it, "--version" does not.
RUN wget -nv -O /tmp/linux-installer.sh https://download.calibre-ebook.com/linux-installer.sh \
 && sh /tmp/linux-installer.sh install_dir=/opt isolated=y version=${CALIBRE_VERSION} \
 && rm -f /tmp/linux-installer.sh \
 && /opt/calibre/calibre-debug -c "from qt.core import QColor, QImage"

ENV CALIBRE_BIN=/opt/calibre \
    QT_QPA_PLATFORM=offscreen \
    KINDLE_TEMP_DIR=/tmp \
    NODE_ENV=production

WORKDIR /app
# The same package versions as the server (package-lock.json); no install scripts run.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY server/src ./server/src
COPY worker/kindle-converter/src ./worker/kindle-converter/src

USER node
CMD ["npx", "tsx", "worker/kindle-converter/src/main.ts"]
