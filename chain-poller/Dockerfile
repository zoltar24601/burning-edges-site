# Run the poller on Playwright's official image, which ships Chromium AND all the
# system shared libraries it needs (libglib, libnss, etc). Railway's default
# Nixpacks image lacks those, so a plain "playwright install" downloads the
# browser but it can't launch. This image fixes that.
# The image tag MUST match the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app
COPY package.json ./
# browsers already live in the image (PLAYWRIGHT_BROWSERS_PATH=/ms-playwright),
# so skip the postinstall download.
RUN npm install --omit=dev --ignore-scripts
COPY . .
CMD ["node", "poller.mjs"]
