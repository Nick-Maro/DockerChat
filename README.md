# Network Security Infrastructure Project

A comprehensive Docker-based network security infrastructure implementing multiple security layers and monitoring capabilities.

## Architecture Overview

This project implements a complete network security infrastructure with the following components:

- **NGINX Reverse Proxy**: Load balances requests between two backend servers
- **Backend Servers**: Two Python Flask servers (server1 & server2) handling requests
- **Programmable Firewall**: Custom rule-based traffic filtering
- **Honeypot**: Captures and logs suspicious traffic for analysis
- **File Receiver**: Network service for secure file uploads
- **Python Client**: Command-line tool for sending files and messages
- **Dashboard**: Real-time network monitoring interface (in development)

The system supports HTTP communication for text messages and uses Docker Compose for container orchestration with bridge networking.

## Prerequisites

- **Docker**: >= 20.x
- **Docker Compose**: >= 1.29.x  
- **Python**: >= 3.8 (for manual client execution)
- **SSL/TLS Certificates**: Optional, for HTTPS implementation

## Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/Nick-Maro/docker-mini-network
cd docker-mini-network
```

### 2. Build and Deploy

```bash
# Build all containers
docker compose build

# Start services in background
docker compose up -d

# Verify all containers are running
docker compose ps
```

### 3. Test the Setup

```bash
# Test backend connectivity
curl -X POST http://127.0.0.1:5000/command -H "Content-Type: application/json" -d "{\"command\":\"ciao\"}"
```

## Container Architecture

| Service | Description | Port | Purpose |
|---------|-------------|------|---------|
| `reverse-proxy` | NGINX load balancer | 8080 | Routes traffic to backends |
| `server1` | Python Flask backend | 5000 | Primary application server |
| `server2` | Python Flask backend | 5000 | Secondary application server |
| `firewall` | Custom traffic filter | - | Rule-based traffic filtering |
| `honeypot` | Security monitoring | - | Suspicious traffic capture |
| `file-receiver` | File upload service | - | Secure file handling |
| `client` | Python sender script | - | Testing and communication |
| `dashboard` | Monitoring interface | - | System visualization |

## Using the Client

### Interactive Mode

```bash
cd client
python sender.py
```

Follow the prompts:
1. **Host**: Enter `localhost` (or remote IP)
2. **Port**: Enter `5000` 
3. **Action**: Choose:
   - `f` - Send a file (provide full path)
   - `m` - Send a text message
   - `q` - Quit

### Programmatic Usage

```python
# Example: Send a message
python sender.py --host localhost --port 5000 --message "Hello Server"

# Example: Send a file
python sender.py --host localhost --port 5000 --file "/path/to/file.txt"
```

## Configuration

### Firewall Rules

Rules are defined in `rules.json` and managed via:
- `firewall.py` - Core filtering logic
- `fwcli.py` - Command-line interface

### Honeypot Configuration

The honeypot automatically logs:
- Connection attempts
- Suspicious traffic patterns
- Malicious payloads
- Access attempts to non-existent resources

## Monitoring and Logs

### Container Logs

```bash
# View all logs in real-time
docker compose logs -f

# View specific container logs
docker compose logs -f reverse-proxy
docker compose logs -f server1

# View logs with timestamps
docker compose logs -f -t
```

### NGINX Logs

```bash
# Access NGINX container
docker exec -it <reverse-proxy-container-id> /bin/bash

# View access logs
tail -f /var/log/nginx/access.log

# View error logs
tail -f /var/log/nginx/error.log
```

## Useful Docker Commands

```bash
# Start services (foreground)
docker compose up

# Start services (background)
docker compose up -d

# Rebuild containers
docker compose build --no-cache

# Stop and remove containers
docker compose down

# Remove containers and volumes
docker compose down -v

# View container status
docker compose ps

# Scale backend servers
docker compose up -d --scale server1=2 --scale server2=2

# Execute commands in containers
docker exec -it <container-name> /bin/bash
```

## Security Features

### Traffic Filtering
- Custom firewall rules
- IP-based blocking/allowing
- Rate limiting capabilities
- Protocol-specific filtering

### Monitoring
- Real-time traffic analysis
- Suspicious activity detection
- Comprehensive logging
- Performance metrics

### Network Isolation
- Docker bridge networking
- Container-to-container communication
- Controlled external access
- Service discovery

## Development Roadmap

- [ ] **TLS/SSL Integration**
  - SSL certificate management
  - HTTPS endpoint configuration  
  - End-to-end encryption

- [ ] **Enhanced Dashboard**
  - Real-time monitoring interface
  - Traffic visualization
  - Alert management
  - Performance analytics

- [ ] **Advanced Firewall**
  - Advanced rule syntax
  - Threat intelligence integration
  - Automated response capabilities

- [ ] **Protocol Extensions**
  - WebSocket support
  - UDP protocol implementation
  - Message queuing systems

- [ ] **Production Features**
  - High availability setup
  - Database integration
  - User authentication
  - API rate limiting



**⚠️ Security Notice**: This is a development/educational project. For production use, ensure proper security hardening, regular updates, and professional security review.