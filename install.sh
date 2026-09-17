#!/bin/sh
# Installs the latest vibechat release binary into ~/.local/bin (or $VIBECHAT_INSTALL_DIR),
# puts that directory on your PATH, and joins a room when given an invite.
#   curl -fsSL https://raw.githubusercontent.com/Awakehsh/vibe-chat/main/install.sh | sh
#   curl -fsSL <server>/install.sh | sh -s -- <server>/TOKEN
set -eu
REPO="Awakehsh/vibe-chat"
DIR="${VIBECHAT_INSTALL_DIR:-$HOME/.local/bin}"
INVITE="${1:-${VIBECHAT_JOIN:-}}"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$OS" in darwin|linux) ;; *) echo "install.sh supports macOS and Linux; on Windows run the PowerShell line from the invite page, or download vibechat-windows-x64.exe from https://github.com/$REPO/releases" >&2; exit 1;; esac
case "$ARCH" in arm64|aarch64) ARCH=arm64;; x86_64|amd64) ARCH=x64;; *) echo "unsupported architecture: $ARCH" >&2; exit 1;; esac
ASSET="vibechat-$OS-$ARCH"
TAG="${VIBECHAT_VERSION:-$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)}"
[ -n "$TAG" ] || { echo "could not determine the latest release; is the repository public?" >&2; exit 1; }
URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
mkdir -p "$DIR"
echo "downloading $URL"
curl -fL --progress-bar "$URL" -o "$DIR/vibechat.tmp"
chmod +x "$DIR/vibechat.tmp"
# Replacing the file in place breaks the signature of a running copy on Apple silicon.
mv -f "$DIR/vibechat.tmp" "$DIR/vibechat"
[ "$OS" = darwin ] && xattr -d com.apple.quarantine "$DIR/vibechat" 2>/dev/null || true
echo "installed $("$DIR/vibechat" --version) to $DIR/vibechat"

# Put the directory on PATH for the next shell, the way the Windows installer does.
case ":$PATH:" in
  *":$DIR:"*) ;;
  *)
    case "$(basename "${SHELL:-sh}")" in
      zsh)  RC="$HOME/.zshrc";                     LINE="export PATH=\"$DIR:\$PATH\"" ;;
      bash) RC="$HOME/.bashrc"; [ -f "$RC" ] || RC="$HOME/.bash_profile"
                                                   LINE="export PATH=\"$DIR:\$PATH\"" ;;
      fish) RC="$HOME/.config/fish/config.fish";   LINE="fish_add_path $DIR" ;;
      *)    RC=""; ;;
    esac
    if [ -n "$RC" ]; then
      mkdir -p "$(dirname "$RC")"
      grep -qF "$LINE" "$RC" 2>/dev/null || printf '\n%s\n' "$LINE" >> "$RC"
      echo "added $DIR to your PATH in $RC"
      echo "open a new terminal, or run:  export PATH=\"$DIR:\$PATH\""
    else
      echo "add to your shell profile:  export PATH=\"$DIR:\$PATH\""
    fi
    ;;
esac

if [ -n "$INVITE" ]; then
  echo
  if "$DIR/vibechat" join "$INVITE"; then
    echo "run  vibechat  to open the chat"
  else
    echo
    echo "vibechat is installed, but joining did not go through."
    echo "open a new terminal, run  vibechat  and type:"
    echo "  /join $INVITE"
    exit 1
  fi
fi
