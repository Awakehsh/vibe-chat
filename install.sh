#!/bin/sh
# Installs the latest vibechat release binary into ~/.local/bin (or $VIBECHAT_INSTALL_DIR).
#   curl -fsSL https://raw.githubusercontent.com/Awakehsh/vibe-chat/main/install.sh | sh
set -eu
REPO="Awakehsh/vibe-chat"
DIR="${VIBECHAT_INSTALL_DIR:-$HOME/.local/bin}"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$OS" in darwin|linux) ;; *) echo "install.sh supports macOS and Linux; on Windows download vibechat-windows-x64.exe from https://github.com/$REPO/releases" >&2; exit 1;; esac
case "$ARCH" in arm64|aarch64) ARCH=arm64;; x86_64|amd64) ARCH=x64;; *) echo "unsupported architecture: $ARCH" >&2; exit 1;; esac
ASSET="vibechat-$OS-$ARCH"
TAG="${VIBECHAT_VERSION:-$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)}"
[ -n "$TAG" ] || { echo "could not determine the latest release; is the repository public?" >&2; exit 1; }
URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
mkdir -p "$DIR"
echo "downloading $URL"
curl -fL --progress-bar "$URL" -o "$DIR/vibechat"
chmod +x "$DIR/vibechat"
[ "$OS" = darwin ] && xattr -d com.apple.quarantine "$DIR/vibechat" 2>/dev/null || true
echo "installed $("$DIR/vibechat" --version) to $DIR/vibechat"
case ":$PATH:" in *":$DIR:"*) ;; *) echo "add to your shell profile:  export PATH=\"$DIR:\$PATH\"";; esac
