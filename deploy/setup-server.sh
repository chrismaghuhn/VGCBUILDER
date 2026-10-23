#!/usr/bin/env bash
# One-time server setup for Teamforge (Ubuntu 24.04). Run on the server:
#   sudo bash setup-server.sh vgcbuilder.duckdns.org
# Installs Caddy from its official repository, creates /var/www/teamforge (owned by the deploy user,
# so `npm run deploy` needs no sudo), opens ports 80/443 if ufw is on, and starts Caddy.
# Nothing else on the server is touched.
set -euo pipefail

DOMAIN="${1:?Usage: sudo bash setup-server.sh <domain>}"
DEPLOY_USER="${SUDO_USER:-duoforge}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [[ $EUID -ne 0 ]]; then echo "Please run with sudo."; exit 1; fi

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
caddy version

echo "==> Web folder /var/www/teamforge (owner: $DEPLOY_USER)"
mkdir -p /var/www/teamforge
chown "$DEPLOY_USER":"$DEPLOY_USER" /var/www/teamforge
[[ -f /var/www/teamforge/index.html ]] || echo '<!doctype html><title>Teamforge</title><p>Coming soon.</p>' > /var/www/teamforge/index.html
chown "$DEPLOY_USER":"$DEPLOY_USER" /var/www/teamforge/index.html

echo "==> Caddyfile for $DOMAIN"
[[ -f /etc/caddy/Caddyfile && ! -f /etc/caddy/Caddyfile.orig ]] && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.orig
sed "s/TEAMFORGE_DOMAIN/$DOMAIN/" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Anything validate created as root must belong to the service user.
chown -R caddy:caddy /var/lib/caddy /var/log/caddy 2>/dev/null || true

echo "==> Firewall"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
else
  echo "ufw is not active: nothing to open here (check your hoster's firewall for ports 80 and 443)."
fi

echo "==> Start"
systemctl enable caddy
systemctl restart caddy
sleep 2
systemctl --no-pager --lines=5 status caddy || true
echo
echo "Done. Caddy fetches the HTTPS certificate on the first request to https://$DOMAIN"
