#!/bin/sh
# Wait for uvicorn to be ready before starting nginx
echo "Waiting for uvicorn on port 8000..."
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 8000 2>/dev/null; then
    echo "uvicorn is ready"
    exec nginx -g "daemon off;"
  fi
  sleep 1
done
echo "ERROR: uvicorn did not start within 30s"
exit 1
