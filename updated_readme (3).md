# Network Security Infrastructure Project

A comprehensive Docker-based network security infrastructure implementing multiple security layers and monitoring capabilities.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Architecture Overview

This project implements a complete network security infrastructure with the following components:

- **NGINX Reverse Proxy**: Load balances requests between backend servers using subdomain routing
- **Backend Servers**: Two Python Flask servers (server1 & server2) handling requests
- **Programmable Firewall**: Custom rule-based traffic filtering
- **File Receiver**: Network service for secure file uploads
- **Python Client**: Command-line tool for sending files and messages
- **Dashboard**: Real-time network monitoring interface accessible via web browser
- **Web-client**: Web client for sending files and messages via browser interface

The system now uses subdomain-based routing with the following endpoints:
- **api.localhost** - Backend API and services
- **dashboard.localhost** - Monitoring dashboard interface
- **client.localhost** - Web client interface

![Network Graph](Graph.png)

## Prerequisites

- **Docker**: >= 20.x
- **Docker Compose**: >= 1.29.x  
- **Python**: >= 3.8 (for manual client execution)

## System Configuration

### Host File Setup

**⚠️ Important**: Before starting the project, you must configure your system's hosts file to enable subdomain routing.

Add the following entries to your hosts file:

**Windows**: Edit `C:\Windows\System32\drivers\etc\hosts`
**Linux/macOS**: Edit `/etc/hosts`

```
127.0.0.1 client.localhost
127.0.0.1 dashboard.localhost
127.0.0.1 api.localhost
```

## Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/Nick-Maro/docker-mini-network
cd docker-mini-network
```

### 2. Configure Hosts File

Follow the [System Configuration](#system-configuration) section above to add the required entries to your hosts file.

### 3. Build and Deploy

```bash
# Build all containers
docker compose build

# Start services in background
docker compose up -d

# Verify all containers are running
docker compose ps
```

### 4. Access the Services

Once running, you can access:
- **API Services**: http://api.localhost
- **Dashboard**: http://dashboard.localhost
- **Web Client**: http://client.localhost

### 5. Test the Setup

```bash
# Test backend connectivity
curl -X POST http://api.localhost/command -H "Content-Type: application/json" -d "{\"command\":\"ciao\"}"
```

## Service Architecture

| Service | Description | URL | Purpose |
|---------|-------------|-----|---------|
| `reverse-proxy` | NGINX subdomain router | - | Routes traffic based on subdomain |
| `server1` | Python Flask backend | api.localhost | Primary application server |
| `server2` | Python Flask backend | api.localhost | Secondary application server |
| `firewall` | Custom traffic filter | api.localhost | Rule-based traffic filtering |
| `file-receiver` | File upload service | api.localhost | Secure file handling |
| `client` | Python sender script | - | Testing and communication |
| `dashboard` | Monitoring interface | dashboard.localhost | System visualization |
| `web-client` | Browser interface | client.localhost | Web-based client |
| `redis` | In-memory database | - | Internal data storage |

## Client Commands Reference

### Interactive Commands

Once connected to the client interface, you can use the following commands:

| Command | Arguments | Description |
|---------|-----------|-------------|
| `j <room_name>` | room name (string) | Join (or create) a room |
| `s <message>` | message (string) | Send message to the current room |
| `p <client_id> <msg>` | client UUID + message | Send **private message** to a specific client (use full ID from `c` command) |
| `r` | — | Read all messages from the current room |
| `pm` | — | Read all **private messages** |
| `l` | — | List all available rooms |
| `c` | — | List all connected clients (with **full IDs**) |
| `e` | — | Leave the current room |
| `h` | — | Show help menu |
| `q` | — | Quit the program |

### Example Usage

```bash
# Join a room
j general

# Send a message to the room
s Hello everyone!

# Send a private message to a specific client
p a1b2c3d4-e5f6-7890-abcd-ef1234567890 Private hello!

# List all connected clients
c

# Read room messages
r

# Check private messages
pm

# List available rooms
l

# Leave current room
e

# Quit the application
q
```

## Using the Client

### Web Interface

1. Open your browser and navigate to http://client.localhost
2. Use the web interface to send files and messages
3. Access real-time chat functionality through the browser

### Command Line Interface

```bash
cd client
python sender.py
```

Follow the prompts:
1. **Host**: Enter `api.localhost`
2. **Action**: Choose:
   - `f` - Send a file (provide full path)
   - `m` - Send a text message
   - `q` - Quit

### Dashboard Monitoring

Access the monitoring dashboard at http://dashboard.localhost to view:
- Real-time system metrics
- Network traffic visualization
- Container status and health
- Security events and logs

### Programmatic Usage

```python
# Example: Send a message
python sender.py --host api.localhost --message "Hello Server"

# Example: Send a file
python sender.py --host api.localhost --file "/path/to/file.txt"
```

## Configuration

### Firewall Rules

Rules are defined in `rules.json` and managed via:
- `firewall.py` - Core filtering logic
- `fwcli.py` - Command-line interface

### NGINX Subdomain Routing

The NGINX configuration now handles subdomain-based routing:
- Requests to `api.localhost` are routed to backend services
- Requests to `dashboard.localhost` serve the monitoring interface
- Requests to `client.localhost` serve the web client

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

## Troubleshooting

### Common Issues

1. **Cannot access subdomains**: Verify hosts file configuration
2. **Container startup failures**: Check Docker and Docker Compose versions
3. **Connection refused**: Ensure all containers are running with `docker compose ps`

### Connectivity Tests

```bash
# Test each subdomain
curl http://api.localhost
curl http://dashboard.localhost
curl http://client.localhost

# Check DNS resolution
nslookup api.localhost
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

## Development Roadmap

### Critical Issues & Code Quality
- [ ] **Code Refactoring**
  - Clean up codebase structure
  - Improve code documentation
  - Standardize coding conventions
  - Remove redundant code

- [ ] **Client Bug Fixes**
  - Fix ability to send messages without joining a room
  - Resolve connection drops and stability issues
  - Improve error handling and reconnection logic
  - Add input validation and sanitization

- [X] **Internationalization**
  - Translate all text content to English
  - Standardize language across all components

### User Interface & Experience
- [X] **Subdomain Architecture**
  - Implement subdomain-based routing
  - Configure NGINX for multiple service endpoints
  - Set up local development environment

- [ ] **Web Client Integration**
  - Enhance client.localhost web interface
  - Implement real-time web communication
  - Add responsive design for mobile devices

- [ ] **Private Groups System**
  - Implement private group creation and management
  - Add invitation-based group access
  - Group-specific permissions and moderation
  - Private group encryption and security

### Communication & Media

- [ ] **File Transfer Implementation**
  - Enhanced file sharing within groups
  - File encryption during transmission
  - Support for multiple file formats
  - File versioning and history

### Security & Cryptography
- [ ] **End-to-End Encryption**
  - Implement message encryption/decryption
  - Generate RSA or AES key pairs for users
  - Secure key exchange protocols
  - Message integrity verification

- [ ] **User Authentication System**
  - Password-based user registration
  - Private key encryption with user password
  - Secure password hashing (bcrypt/scrypt)
  - Session management and token authentication

- [ ] **Network Security Hardening**
  - Port security and access control
  - Network segmentation and isolation
  - Container security best practices
  - TLS/SSL certificate management

- [ ] **Advanced Firewall**
  - Enhanced rule-based filtering
  - DDoS protection mechanisms
  - Intrusion detection and prevention
  - Real-time threat monitoring
  - Automated security response

### Infrastructure & Performance
- [ ] **TLS/SSL Integration**
  - HTTPS endpoint configuration
  - SSL certificate automation
  - Secure WebSocket connections

- [ ] **Protocol Extensions**
  - WebSocket support for real-time communication
  - UDP protocol implementation for voice and real-time data

- [ ] **Dashboard Enhancements**
  - Real-time metrics visualization
  - Advanced monitoring capabilities
  - Performance analytics

- [ ] **Production Features**
  - Performance monitoring and optimization
  - Scalability improvements
  - Load balancing enhancements

**⚠️ Security Notice**: This is a development/educational project. For production use, ensure proper security hardening, regular updates, and professional security review.

## Contributing

When contributing to this project, please ensure:
1. Hosts file configuration is documented for new services
2. Subdomain routing is properly configured in NGINX
3. All services are accessible via their designated subdomains
4. Documentation is updated to reflect any architectural changes