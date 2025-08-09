import json
import socket
import threading
import os
import logger
from dotenv import load_dotenv
load_dotenv()

BLACKLIST_FILE = "rules.json"
FIREWALL_PORT = int(os.getenv("FIREWALL_PORT", 5000))
REVERSE_PROXY_IP = "reverse-proxy"  
REVERSE_PROXY_PORT = int(os.getenv("REVERSE_PROXY_PORT", 8080))

BUFFER_SIZE = 4096

def load_rules():
    try:
        with open(BLACKLIST_FILE, 'r') as f:
            return json.load(f)
    except:
        return {"blacklist": [], "whitelist": []}

def is_blocked(ip, rules):
    return ip in rules.get("blacklist", [])

def forward_data(src, dst):

    try:
        while True:
            data = src.recv(BUFFER_SIZE)
            if not data:
                break
            dst.sendall(data)
    except:
        pass
    finally:
        src.close()
        dst.close()

def handle_client(client_sock, client_addr, rules):
    ip = client_addr[0]
    print(f"[DEBUG] Connection from {ip}")

    if is_blocked(ip, rules):
        logger.log(f"[BLOCKED] Connection from {ip}")
        client_sock.close()
        return

    logger.log(f"[ALLOWED] Connection from {ip}")

    try:

        proxy_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        proxy_sock.connect((REVERSE_PROXY_IP, REVERSE_PROXY_PORT))
    except Exception as e:
        print(f"[ERROR] Cannot connect to reverse proxy: {e}")
        client_sock.close()
        return


    threading.Thread(target=forward_data, args=(client_sock, proxy_sock), daemon=True).start()
    threading.Thread(target=forward_data, args=(proxy_sock, client_sock), daemon=True).start()

def main():
    rules = load_rules()

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("0.0.0.0", FIREWALL_PORT))
    sock.listen(5)
    print(f"[FIREWALL] Listening on port {FIREWALL_PORT}...")

    while True:
        conn, addr = sock.accept()
        threading.Thread(target=handle_client, args=(conn, addr, rules), daemon=True).start()

if __name__ == "__main__":
    main()
