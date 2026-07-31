# Linux image for a reproducible web export.
#
# The build script itself downloads and caches the pinned Godot editor and
# export templates under .tmp/, so this image only has to supply the tools it
# shells out to. Keeping the toolchain in the (bind-mounted) workspace means a
# container rebuild does not re-download 1.4 GB.

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      unzip \
      nodejs \
      python3 \
      make \
    && rm -rf /var/lib/apt/lists/*

# Godot's headless export still initializes a rendering driver.
ENV DISPLAY=""
WORKDIR /workspace

ENTRYPOINT ["bash", "scripts/build-smbros-web.sh"]
