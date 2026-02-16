# Deployment Guide

Deploy the worker stack (RabbitMQ + Dispatcher + Worker) on Ubuntu 24.04.

## Prerequisites

- Ubuntu 24.04 LTS VM (2GB RAM, 1 CPU minimum)
- SSH access to the VM

## 1. Install Docker

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh

# Add your user to docker group (logout/login required)
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Verify installation
docker --version
docker compose version
```

Log out and back in for group changes to take effect.

## 2. Clone Repository

```bash
git clone https://github.com/your-org/virtual-personas-arena.git
cd virtual-personas-arena
```

## 3. Configure Environment

Create `.env` file in the project root:

```bash
nano .env
```

Add the following (replace with your actual values):

```bash
# RabbitMQ
RABBITMQ_USER=arena
RABBITMQ_PASS=<generate-strong-password>

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=<your-service-key>

# LLM (will be moved to Supabase later)
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=<your-api-key>
OPENROUTER_MODEL=anthropic/claude-3-haiku
```

Generate a strong password:
```bash
openssl rand -base64 32
```

## 4. Start Services

```bash
# Build and start all services
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f

# View specific service logs
docker compose logs -f worker
docker compose logs -f dispatcher
docker compose logs -f rabbitmq
```

## 5. Verify Deployment

Check that all services are healthy:

```bash
docker compose ps
```

Expected output:
```
NAME                    STATUS                   PORTS
arena-dispatcher-1      Up X minutes
arena-rabbitmq-1        Up X minutes (healthy)   127.0.0.1:5672->5672/tcp, 127.0.0.1:15672->15672/tcp
arena-worker-1          Up X minutes
```

## Management

### Scale Workers

```bash
# Run 2 workers in parallel
docker compose up -d --scale worker=2

# Check running workers
docker compose ps
```

### Access RabbitMQ Management UI

The management UI is bound to localhost only. Use SSH tunnel:

```bash
# On your local machine
ssh -L 15672:localhost:15672 user@your-vm-ip

# Then open in browser
http://localhost:15672
# Login: arena / <your-password>
```

### Update Deployment

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose up -d --build
```

### Stop Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (WARNING: deletes RabbitMQ data)
docker compose down -v
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f worker

# Last 100 lines
docker compose logs --tail=100 worker
```

### Restart a Service

```bash
docker compose restart worker
docker compose restart dispatcher
```

## Troubleshooting

### Worker can't connect to RabbitMQ

Check RabbitMQ is healthy:
```bash
docker compose ps rabbitmq
docker compose logs rabbitmq
```

### Worker can't connect to Supabase

Verify environment variables:
```bash
docker compose exec worker env | grep SUPABASE
```

### Check resource usage

```bash
docker stats
```

### Clear stuck messages

Access RabbitMQ management UI and purge the queue, or:
```bash
docker compose exec rabbitmq rabbitmqctl purge_queue survey_tasks
```

## Security Notes

1. **RabbitMQ ports are localhost-only** - Not exposed to the internet
2. **Use strong passwords** - Generate with `openssl rand -base64 32`
3. **Keep `.env` secure** - Never commit to git (already in `.gitignore`)
4. **SSH tunnel for management UI** - Don't expose port 15672 publicly
