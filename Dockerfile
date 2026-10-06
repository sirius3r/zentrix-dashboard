# Zentrix Homelab Dashboard — Docker image
# Build context = this directory; runtime needs only python (stdlib only).
FROM docker.io/library/python:3.12-alpine

# Run unprivileged — fixed uid/gid 1000 for bind-mount compatibility
# (host dirs chowned to 1000:1000 keep working across image updates)
RUN addgroup -g 1000 -S zentrix && adduser -u 1000 -G zentrix -S -h /app zentrix \
    && mkdir -p /data && chown zentrix:zentrix /data /app

WORKDIR /app
COPY --chown=zentrix:zentrix index.html app.js bg.js i18n.js zentrix-server.py server_i18n.py immich_client.py /app/

# State lives on a volume, token comes from a secret (see stack file)
ENV ZENTRIX_DATA_FILE=/data/links.json \
    ZENTRIX_TOKEN_FILE=/run/secrets/zentrix_token

VOLUME /data
USER zentrix
EXPOSE 8080
ENTRYPOINT ["python3", "/app/zentrix-server.py"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python3", "-c", "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=2).status == 200 else 1)"]