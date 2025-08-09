import socket
import threading
from datetime import datetime

LOG_FILE = "log.txt"

def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a") as f:
        f.write(f"[{timestamp}] {message}\n")
    print(message)

def handle_tcp_client(conn, addr):
    log(f"TCP connection from {addr[0]}:{addr[1]}")
    try:
        data = conn.recv(1024)
        if data:
            log(f"TCP data from {addr[0]}:{addr[1]}: {data.hex()}")
      
    except Exception as e:
        log(f"TCP handler error: {e}")
    finally:
        conn.close()

def tcp_server(host="0.0.0.0", port=9999):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind((host, port))
    s.listen(5)
    log(f"Honeypot TCP listening on {host}:{port}")
    while True:
        conn, addr = s.accept()
        threading.Thread(target=handle_tcp_client, args=(conn, addr), daemon=True).start()

def udp_server(host="0.0.0.0", port=9999):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind((host, port))
    log(f"Honeypot UDP listening on {host}:{port}")
    while True:
        data, addr = s.recvfrom(1024)
        log(f"UDP packet from {addr[0]}:{addr[1]}: {data.hex()}")

def main():
    threading.Thread(target=tcp_server, daemon=True).start()
    threading.Thread(target=udp_server, daemon=True).start()

    print("Honeypot running (TCP + UDP) on port 9999...")
    try:
        while True:
            pass
    except KeyboardInterrupt:
        print("Honeypot shutting down.")

if __name__ == "__main__":
    main()
