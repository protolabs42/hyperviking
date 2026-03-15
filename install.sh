#!/bin/sh
set -e

# HyperViking installer — works on macOS, Linux, WSL
# curl -fsSL https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.sh | sh

REPO="https://github.com/protolabs42/hyperviking.git"
INSTALL_DIR="${HYPERVIKING_HOME:-$HOME/.hyperviking}"

echo "HyperViking — encrypted P2P knowledge brain for AI agents"
echo ""

# ── Check Node.js ──

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js not found. Install Node.js 18+ first: https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "error: Node.js 18+ required (found $(node -v))"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "error: git not found."
  exit 1
fi

# ── Install or update ──

if [ -d "$INSTALL_DIR/repo/.git" ]; then
  echo "updating..."
  cd "$INSTALL_DIR/repo"
  git pull --ff-only 2>/dev/null || git pull
else
  echo "installing to $INSTALL_DIR..."
  mkdir -p "$INSTALL_DIR"
  git clone "$REPO" "$INSTALL_DIR/repo"
  cd "$INSTALL_DIR/repo"
fi

# ── Build ──

npm install --ignore-scripts 2>/dev/null
npm run build
npm prune --production 2>/dev/null
chmod +x "$INSTALL_DIR/repo/dist/cli.js"

# ── Link binary ──

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/repo/dist/cli.js" "$BIN_DIR/hv"

# ── Check PATH ──

case ":$PATH:" in
  *":$BIN_DIR:"*) ;; # already in PATH
  *)
    SHELL_NAME=$(basename "${SHELL:-/bin/sh}")
    case "$SHELL_NAME" in
      zsh)  RC="$HOME/.zshrc" ;;
      bash) RC="$HOME/.bashrc" ;;
      fish) RC="$HOME/.config/fish/config.fish" ;;
      *)    RC="$HOME/.profile" ;;
    esac

    if [ "$SHELL_NAME" = "fish" ]; then
      echo "fish_add_path $BIN_DIR" >> "$RC"
    else
      echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$RC"
    fi
    echo "added $BIN_DIR to PATH in $RC"
    echo "run: source $RC"
    export PATH="$BIN_DIR:$PATH"
    ;;
esac

echo ""
echo "installed: hv $(hv --version 2>/dev/null || echo "ready")"
echo ""

# If --server flag passed, run full server setup
case "$*" in
  *--server*)
    echo "Starting server setup..."
    echo ""
    hv setup-server
    exit 0
    ;;
  *--solo*)
    echo "Starting solo server setup..."
    echo ""
    hv setup-server --solo
    exit 0
    ;;
esac

echo "  hv init              setup your keypair"
echo "  hv init --server     setup a server"
echo "  hv setup-server      full server setup (OpenViking + RBAC)"
echo "  hv help              all commands"
