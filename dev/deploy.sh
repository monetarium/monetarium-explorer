#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
#  Monetarium Explorer — Deployment Script
#  Target: Ubuntu 22.04+
#  Usage:  edit variables below, then ./deploy.sh
#  ⚠  Do NOT run with sudo — sudo is called internally
# ═══════════════════════════════════════════════════════════════

# ─── CONFIGURATION — EDIT THESE BEFORE RUNNING ────────────────

# Network: "mainnet" or "testnet"
NETWORK="mainnet"

# Docker image (built by CI, pushed to registry)
DOCKER_IMAGE="ghcr.io/monetarium/monetarium-explorer:latest"

# monetarium-node RPC
MONETARIUM_RPC_USER="monuser"
MONETARIUM_RPC_PASS=""
MONETARIUM_RPC_HOST="127.0.0.1"
MONETARIUM_RPC_PORT="19500"          # mainnet: 19500, testnet: 19509
MONETARIUM_DATA_DIR="$HOME/.monetarium"
# Note: RPC cert path is hardcoded in the config template (container path), not this var.

# PostgreSQL
PG_USER="monetarium_explorer"
PG_PASS=""
PG_DBNAME="monetarium_explorer_mainnet"
PG_HOST="127.0.0.1:5432"            # TCP required when explorer runs in Docker

# Explorer config
EXPLORER_PORT="7777"
EXPLORER_CONFIG_DIR="$HOME/.monetarium-explorer"

# nginx reverse proxy
DOMAIN=""                            # set e.g. "explorer.example.com" for HTTPS
SSL_EMAIL="admin@example.com"
NGINX_CACHE_DIR="/var/cache/nginx"

# ─── END CONFIGURATION ────────────────────────────────────────


# ═══════════════════════════════════════════════════════════════
#  INTERNAL — do not edit below this line
# ═══════════════════════════════════════════════════════════════

ORIGINAL_USER="$USER"
ORIGINAL_HOME="$HOME"

BOLD='\033[1m'
DIM='\033[2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "  ${DIM}→${NC} $*"; }
ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
skip()  { echo -e "  ${YELLOW}−${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $*"; }
err()   { echo -e "  ${RED}✗${NC} $*" >&2; exit 1; }
title() { echo -e "\n${BOLD}── $*${NC}"; }

PG_IS_SOCKET=false
if echo "$PG_HOST" | grep -q '/'; then
  PG_IS_SOCKET=true
fi

if [ "$NETWORK" = "testnet" ]; then
  NET_OPTION="testnet=1"
  if [ "$MONETARIUM_RPC_PORT" = "19500" ]; then
    MONETARIUM_RPC_PORT="19509"
  fi
else
  NET_OPTION=""
fi

if [ -z "$MONETARIUM_RPC_PASS" ]; then
  MONETARIUM_RPC_PASS="$(openssl rand -base64 24)"
fi

if [ -z "$PG_PASS" ]; then
  PG_PASS="$(openssl rand -base64 24)"
fi

REGISTRY="$(echo "$DOCKER_IMAGE" | cut -d'/' -f1)"
if echo "$DOCKER_IMAGE" | grep -q '@'; then
  DOCKER_IMAGE_TAG="${DOCKER_IMAGE%%@*}"
else
  DOCKER_IMAGE_TAG="$DOCKER_IMAGE"
fi


# ═══════════════════════════════════════════════════════════════
#  1. Install system packages
# ═══════════════════════════════════════════════════════════════

title "1/9 — Installing system packages"

sudo apt-get update -qq
sudo apt-get install -y -qq \
  docker.io \
  nginx \
  postgresql \
  certbot \
  python3-certbot-nginx \
  ca-certificates \
  curl \
  openssl \
  > /dev/null

ok "Packages installed"


# ═══════════════════════════════════════════════════════════════
#  2. Enable and start services
# ═══════════════════════════════════════════════════════════════

title "2/9 — Enabling services"

sudo systemctl enable --now docker    > /dev/null 2>&1
sudo systemctl enable --now postgresql > /dev/null 2>&1
ok "docker, postgresql enabled and started"

if ! groups "$ORIGINAL_USER" | grep -q docker; then
  sudo usermod -aG docker "$ORIGINAL_USER"
  warn "User added to docker group — log out/in or run 'newgrp docker' before docker commands"
fi


# ═══════════════════════════════════════════════════════════════
#  3. PostgreSQL — role + database
# ═══════════════════════════════════════════════════════════════

title "3/9 — Setting up PostgreSQL"

sudo -u postgres psql -tc \
  "SELECT 1 FROM pg_roles WHERE rolname='$PG_USER'" \
  | grep -q 1 \
  && skip "Role '$PG_USER' already exists" \
  || {
    sudo -u postgres psql -c "CREATE ROLE $PG_USER LOGIN PASSWORD '$PG_PASS';" > /dev/null
    ok "Role '$PG_USER' created"
  }

sudo -u postgres psql -tc \
  "SELECT 1 FROM pg_database WHERE datname='$PG_DBNAME'" \
  | grep -q 1 \
  && skip "Database '$PG_DBNAME' already exists" \
  || {
    sudo -u postgres psql -c "CREATE DATABASE $PG_DBNAME OWNER $PG_USER;" > /dev/null
    ok "Database '$PG_DBNAME' created"
  }

if ! $PG_IS_SOCKET; then
  PG_HBA_CONF="$(sudo -u postgres psql -t -c 'SHOW hba_file;' 2>/dev/null | tr -d ' ')"
  if [ -n "$PG_HBA_CONF" ] && [ -f "$PG_HBA_CONF" ]; then
    if ! sudo grep -q "host.*$PG_DBNAME.*$PG_USER" "$PG_HBA_CONF" 2>/dev/null; then
      echo "host $PG_DBNAME $PG_USER 127.0.0.1/32 scram-sha-256" \
        | sudo tee -a "$PG_HBA_CONF" > /dev/null
      sudo systemctl reload postgresql
      ok "pg_hba.conf updated for TCP"
    fi
  fi
fi


# ═══════════════════════════════════════════════════════════════
#  4. Create config directories
# ═══════════════════════════════════════════════════════════════

title "4/9 — Creating config directories"

mkdir -p "$MONETARIUM_DATA_DIR"
mkdir -p "$EXPLORER_CONFIG_DIR"
sudo mkdir -p "$NGINX_CACHE_DIR"
sudo chmod 750 "$NGINX_CACHE_DIR"
ok "Directories ready"


# ═══════════════════════════════════════════════════════════════
#  5. monetarium.conf

title "5/9 — Writing monetarium.conf"

NODE_CONF="$MONETARIUM_DATA_DIR/monetarium.conf"
if [ -f "$NODE_CONF" ]; then
  skip "$NODE_CONF already exists"
else
  cat > "$NODE_CONF" << EOF
# monetarium — generated by monetarium-explorer deploy.sh
${NET_OPTION}
rpcuser=${MONETARIUM_RPC_USER}
rpcpass=${MONETARIUM_RPC_PASS}
rpclisten=127.0.0.1:${MONETARIUM_RPC_PORT}
txindex=1
EOF
  ok "$NODE_CONF"
fi


# ═══════════════════════════════════════════════════════════════
#  6. monetarium-explorer.conf
# ═══════════════════════════════════════════════════════════════

title "6/9 — Writing monetarium-explorer.conf"

EXPLORER_CONF="$EXPLORER_CONFIG_DIR/monetarium-explorer.conf"
if [ -f "$EXPLORER_CONF" ]; then
  skip "$EXPLORER_CONF already exists"
else
  cat > "$EXPLORER_CONF" << EOF
[Application Options]

; monetarium-node RPC credentials
dcrduser=${MONETARIUM_RPC_USER}
dcrdpass=${MONETARIUM_RPC_PASS}
dcrdserv=${MONETARIUM_RPC_HOST}:${MONETARIUM_RPC_PORT}
dcrdcert=/home/explorer/.monetarium/rpc.cert
;nodaemontls=1

; PostgreSQL — set pgdbname to enable PG mode
pgdbname=${PG_DBNAME}
pguser=${PG_USER}
pgpass=${PG_PASS}
pghost=${PG_HOST}

; Web interface — listen on loopback, nginx proxies
apilisten=127.0.0.1:${EXPLORER_PORT}
apiproto=http

; Reverse proxy settings (nginx in front)
trustproxy=true
userealip=true

; Logging
debuglevel=info

; Cache
cachecontrol-maxage=86400
EOF
  ok "$EXPLORER_CONF"
fi


# ═══════════════════════════════════════════════════════════════
#  7. nginx — cache config + site
# ═══════════════════════════════════════════════════════════════

title "7/9 — Writing nginx configuration"

# Site config — based on docs/nginx-sample.cfg
NGINX_SITE="/etc/nginx/sites-available/monetarium-explorer"
if [ -f "$NGINX_SITE" ]; then
  skip "$NGINX_SITE already exists"
else
  if [ -n "$DOMAIN" ]; then
    SERVER_NAME="$DOMAIN"
  else
    SERVER_NAME="_"
  fi

  sudo tee "$NGINX_SITE" > /dev/null << NGINXCONF
upstream monetarium_explorer {
    server 127.0.0.1:${EXPLORER_PORT};
}

server {
    listen 80;
    server_name ${SERVER_NAME};

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_types text/css text/javascript application/javascript application/json
               application/xml image/svg+xml;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "same-origin" always;

    set_real_ip_from 127.0.0.1/32;
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;

    location / {
        proxy_pass http://monetarium_explorer;
        proxy_http_version 1.1;

        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /ws {
        proxy_pass http://monetarium_explorer;
        proxy_http_version 1.1;

        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;

        proxy_read_timeout 86400;
    }
}
NGINXCONF
  ok "$NGINX_SITE"
fi

# Symlink to sites-enabled
if [ ! -L /etc/nginx/sites-enabled/monetarium-explorer ]; then
  sudo ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/monetarium-explorer
  ok "Site enabled"
fi


# ═══════════════════════════════════════════════════════════════
#  8. systemd service
# ═══════════════════════════════════════════════════════════════

title "8/9 — Writing systemd service"

# Normalize paths — systemd needs real paths, no ~ or $HOME
NODE_PATH="$(realpath -m "$MONETARIUM_DATA_DIR")"
EXPLORER_PATH="$(realpath -m "$EXPLORER_CONFIG_DIR")"

sudo tee /etc/systemd/system/monetarium-explorer.service > /dev/null << SYSTEMD
[Unit]
Description=Monetarium Explorer
After=docker.service
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
Restart=always
RestartSec=15

ExecStartPre=-/usr/bin/docker rm -f monetarium-explorer 2>/dev/null
ExecStart=/usr/bin/docker run \\
  --rm \\
  --name monetarium-explorer \\
  --network host \\
  -v ${NODE_PATH}:/home/explorer/.monetarium:ro \\
  -v ${EXPLORER_PATH}:/home/explorer/.monetarium-explorer \\
  ${DOCKER_IMAGE_TAG}
ExecStop=/usr/bin/docker stop -t 30 monetarium-explorer
ExecStopPost=-/usr/bin/docker rm -f monetarium-explorer 2>/dev/null

[Install]
WantedBy=multi-user.target
SYSTEMD

sudo systemctl daemon-reload
ok "/etc/systemd/system/monetarium-explorer.service"


# ═══════════════════════════════════════════════════════════════
#  9. Enable and start services
# ═══════════════════════════════════════════════════════════════

title "9/9 — Enabling services"

sudo systemctl enable --now monetarium-explorer 2>/dev/null || warn "Explorer service not started (image not pulled yet)"
sudo nginx -t && sudo systemctl reload nginx 2>/dev/null || sudo systemctl start nginx

if [ -n "$DOMAIN" ]; then
  title "  → Running certbot for $DOMAIN"
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$SSL_EMAIL" \
    || warn "certbot failed — run manually: sudo certbot --nginx -d $DOMAIN"
fi

ok "Services configured"


# ═══════════════════════════════════════════════════════════════
#  SUMMARY
# ═══════════════════════════════════════════════════════════════

title "═══ DEPLOYMENT SUMMARY ═══"

echo
echo -e "  ${BOLD}Configuration files created:${NC}"
echo -e "    ${DIM}•${NC} $NODE_CONF"
echo -e "    ${DIM}•${NC} $EXPLORER_CONF"
echo -e "    ${DIM}•${NC} $NGINX_SITE"
echo

echo -e "  ${BOLD}PostgreSQL credentials:${NC}"
echo -e "    ${DIM}•${NC} User:     $PG_USER"
echo -e "    ${DIM}•${NC} Password: ${YELLOW}$PG_PASS${NC}"
echo -e "    ${DIM}•${NC} Database: $PG_DBNAME"
echo -e "    ${DIM}•${NC} Host:     $PG_HOST"
echo

echo -e "  ${BOLD}monetarium-node RPC:${NC}"
echo -e "    ${DIM}•${NC} User:     $MONETARIUM_RPC_USER"
echo -e "    ${DIM}•${NC} Password: ${YELLOW}$MONETARIUM_RPC_PASS${NC}"
echo

if [ -n "$DOMAIN" ]; then
  echo -e "  ${BOLD}URL:${NC} https://$DOMAIN"
else
  echo -e "  ${BOLD}URL:${NC} http://$(hostname -I | awk '{print $1}'):7777"
fi
echo

echo -e "  ${BOLD}What to do now:${NC}"
echo -e "  ${DIM}1.${NC} Verify monetarium-node is running and synced"
echo -e "  ${DIM}2.${NC} Login to container registry and pull the image (see below)"
echo -e "  ${DIM}3.${NC} Start the explorer: ${BOLD}sudo systemctl start monetarium-explorer${NC}"
echo -e "  ${DIM}4.${NC} Check logs: ${BOLD}sudo journalctl -u monetarium-explorer -f${NC}"
echo

# ═══════════════════════════════════════════════════════════════
#  Docker login + pull (at the very end, manual fallback)
# ═══════════════════════════════════════════════════════════════

title "═══ Docker registry (manual fallback if this fails) ═══"

if echo "$REGISTRY" | grep -q '[.:]'; then
  echo
  echo -e "  ${DIM}Logging in to ${BOLD}$REGISTRY${NC}${DIM}...${NC}"
  echo
  docker login "$REGISTRY" || warn "Login failed — run manually: docker login $REGISTRY"
else
  skip "No custom registry detected — using Docker Hub default auth"
fi

echo
echo -e "  ${DIM}Pulling ${BOLD}$DOCKER_IMAGE_TAG${NC}${DIM}...${NC}"
echo
docker pull "$DOCKER_IMAGE_TAG" \
  && ok "Image pulled" \
  || warn "Pull failed — run manually: docker pull $DOCKER_IMAGE_TAG"

echo
echo -e "  ${GREEN}${BOLD}Done.${NC} Run ${BOLD}sudo systemctl start monetarium-explorer${NC} to launch."
echo
