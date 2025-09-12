#!/bin/sh
set -e

if [ "$PRODUCTION" = "TRUE" ]; then
    CLIENT_TLS_BLOCK="ssl_certificate ${CLIENT_CERT}/fullchain.pem; ssl_certificate_key ${CLIENT_CERT}/privkey.pem;"
    DASHBOARD_TLS_BLOCK="ssl_certificate ${DASHBOARD_CERT}/fullchain.pem; ssl_certificate_key ${DASHBOARD_CERT}/privkey.pem;"
    API_TLS_BLOCK="ssl_certificate ${API_CERT}/fullchain.pem; ssl_certificate_key ${API_CERT}/privkey.pem;"
    CLIENT_LISTEN_PORT="443 ssl"
    DASHBOARD_LISTEN_PORT="443 ssl"
    API_LISTEN_PORT="443 ssl"
else
    CLIENT_TLS_BLOCK=""
    DASHBOARD_TLS_BLOCK=""
    API_TLS_BLOCK=""
    CLIENT_LISTEN_PORT=${CLIENT_PORT}
    DASHBOARD_LISTEN_PORT=${DASHBOARD_PORT}
    API_LISTEN_PORT=${API_LISTEN_PORT}
fi

SERVER_UPSTREAM="${SERVER_HOST}:${SERVER_PORT}"

# substitution
sed -e "s|SERVER_UPSTREAM_PLACEHOLDER|$SERVER_UPSTREAM|g" \
    -e "s|CLIENT_HOST_PLACEHOLDER|$CLIENT_HOST|g" \
    -e "s|CLIENT_PORT_PLACEHOLDER|$CLIENT_PORT|g" \
    -e "s|CLIENT_LISTEN_PORT_PLACEHOLDER|$CLIENT_LISTEN_PORT|g" \
    -e "s|CLIENT_TLS_BLOCK_PLACEHOLDER|$CLIENT_TLS_BLOCK|g" \
    -e "s|DASHBOARD_HOST_PLACEHOLDER|$DASHBOARD_HOST|g" \
    -e "s|DASHBOARD_PORT_PLACEHOLDER|$DASHBOARD_PORT|g" \
    -e "s|DASHBOARD_LISTEN_PORT_PLACEHOLDER|$DASHBOARD_LISTEN_PORT|g" \
    -e "s|DASHBOARD_TLS_BLOCK_PLACEHOLDER|$DASHBOARD_TLS_BLOCK|g" \
    -e "s|API_HOST_PLACEHOLDER|$API_HOST|g" \
    -e "s|API_LISTEN_PORT_PLACEHOLDER|$API_LISTEN_PORT|g" \
    -e "s|API_TLS_BLOCK_PLACEHOLDER|$API_TLS_BLOCK|g" \
    /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

nginx -t
exec nginx -g "daemon off;"