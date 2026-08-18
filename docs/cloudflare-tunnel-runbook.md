# Cloudflare Tunnel Laptop Migration Runbook

This runbook moves the existing `arcline-demo.thesoftwareconsulting.com` tunnel connector to another laptop. The Cloudflare tunnel and DNS route already exist in Cloudflare; a replacement laptop only needs the repository, application secrets/data, and the tunnel token. Do not create another tunnel or DNS record for a normal migration.

The public URL works only while at least one laptop is online, Docker Desktop is running, the application is healthy, and its `cloudflared` container is connected.

## Current route

| Setting | Value |
| --- | --- |
| Public hostname | `https://arcline-demo.thesoftwareconsulting.com` |
| Cloudflare tunnel | `arcline-demo-mac` |
| Tunnel ID | `83a082dd-6b93-4c6b-9749-3a42c19e92c9` |
| Container origin | `http://api:8080` |
| Compose override | `docker-compose.demo.yml` |

The tunnel container and API share Compose's private network. PostgreSQL, Qdrant, MinerU, and the model server are not exposed through separate public routes.

## Prerequisites on the destination laptop

1. Install Git and Docker Desktop.
2. Enable **Start Docker Desktop when you sign in** if the demo must recover after a laptop reboot.
3. Clone this repository and check out the intended commit or branch.
4. Copy `.env` through an encrypted channel, or build a new `.env` from `.env.example`. Never send `.env` through chat, email, source control, or an unencrypted shared drive.
5. Transfer or restore the PostgreSQL and Qdrant data if the destination must contain the same accounts, documents, chats, and indexes. Moving only the tunnel does not move application data.
6. Install and start the local model runtime required by the application, using the same model identifiers configured in `.env`.

The destination `.env` must contain:

```dotenv
PUBLIC_APP_URL=https://arcline-demo.thesoftwareconsulting.com
ALLOWED_HOSTS=localhost,127.0.0.1,arcline-demo.thesoftwareconsulting.com
COOKIE_SECURE=true
CLOUDFLARE_TUNNEL_TOKEN=<retrieve securely from Cloudflare>
```

Get the token from Cloudflare Dashboard: **Networking → Tunnels → arcline-demo-mac → Add a replica**. Treat it as a password. Do not paste it into shell history; edit the ignored `.env` file directly or inject it from a secret manager.

## Start the destination laptop

For a Mac or another machine without NVIDIA CUDA:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cpu.yml \
  -f docker-compose.demo.yml \
  up --build -d
```

For an NVIDIA host using the default GPU profile:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.demo.yml \
  up --build -d
```

The `cloudflared` service has `restart: unless-stopped`. It reconnects when Docker restarts, but Docker Desktop itself must be running.

## Verify before cutting over

Check the local application and connector:

```bash
curl --fail http://127.0.0.1:8080/healthz

docker compose \
  -f docker-compose.yml \
  -f docker-compose.cpu.yml \
  -f docker-compose.demo.yml \
  ps api cloudflared

docker compose \
  -f docker-compose.yml \
  -f docker-compose.cpu.yml \
  -f docker-compose.demo.yml \
  logs --tail=50 cloudflared
```

The logs should contain `Registered tunnel connection`. Cloudflare Dashboard should show two healthy replicas if both laptops are still connected. Then verify the public route:

```bash
curl --fail --show-error https://arcline-demo.thesoftwareconsulting.com/healthz
```

Open the public URL in a private browser window and test login before stopping the old laptop.

## Cutover without unnecessary downtime

1. Start and verify the destination connector first.
2. Confirm the destination is a healthy replica in Cloudflare Dashboard.
3. Stop only the tunnel connector on the old laptop:

   ```bash
   docker compose \
     -f docker-compose.yml \
     -f docker-compose.cpu.yml \
     -f docker-compose.demo.yml \
     stop cloudflared
   ```

4. Confirm the public health endpoint still succeeds.
5. Stop the rest of the old stack only after application data has been moved and the destination stack has been validated.

Do not run two independent writable PostgreSQL/Qdrant stacks as though they were replicas. Two tunnel connectors are safe during the connector cutover, but Cloudflare may send traffic to either one. Keep the overlap short unless both connectors intentionally serve the same shared application state.

## Rollback

If the destination fails, restart the old connector:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.cpu.yml \
  -f docker-compose.demo.yml \
  up -d cloudflared
```

No DNS change is required. Cloudflare routes traffic to any healthy connector registered to the existing tunnel.

## Token rotation

Rotate the token immediately if it is disclosed or copied through an untrusted channel:

1. Open **Cloudflare Dashboard → Networking → Tunnels → arcline-demo-mac**.
2. Choose **Rotate token**. This invalidates the previous token for every laptop.
3. Put the replacement token into `.env` on the destination laptop.
4. Recreate the connector:

   ```bash
   docker compose \
     -f docker-compose.yml \
     -f docker-compose.cpu.yml \
     -f docker-compose.demo.yml \
     up -d --force-recreate cloudflared
   ```

5. Verify the public health endpoint again.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Cloudflare error `1033` | No healthy tunnel connector | Start Docker and `cloudflared`; inspect its logs and token |
| HTTP `502` | Tunnel is connected but cannot reach the API | Confirm `api` is healthy and the route service remains `http://api:8080` |
| HTTP `400` or rejected host | Public hostname missing from application configuration | Check `ALLOWED_HOSTS`, then recreate the API container |
| Login cookie does not persist | Public URL or secure-cookie configuration is wrong | Check `PUBLIC_APP_URL` and `COOKIE_SECURE=true` |
| Connector exits immediately | Missing, malformed, or rotated token | Retrieve the current token securely and recreate `cloudflared` |
| Demo disappears after reboot | Docker Desktop did not start | Enable login startup and verify the containers use `restart: unless-stopped` |

Do not delete the Cloudflare tunnel or its CNAME during laptop migration. Delete them only when permanently retiring the public demo hostname.
