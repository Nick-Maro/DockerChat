import socket
import os
from datetime import datetime

UPLOAD_DIR = "uploads"
LOG_FILE = "log.txt"
PORT = 8888

def log(message):
    with open(LOG_FILE, "a") as f:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        f.write(f"[{timestamp}] {message}\n")
    print(message)

def receive_file(conn):
    filename_size = int.from_bytes(conn.recv(4), 'big')
    filename = conn.recv(filename_size).decode()

    filesize = int.from_bytes(conn.recv(8), 'big')
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, 'wb') as f:
        bytes_received = 0
        while bytes_received < filesize:
            data = conn.recv(min(4096, filesize - bytes_received))
            if not data:
                break
            f.write(data)
            bytes_received += len(data)

    log(f"Received file: {filename} ({filesize} bytes)")

def main():
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("0.0.0.0", PORT))
    s.listen(5)
    log(f"File receiver listening on port {PORT}...")

    while True:
        conn, addr = s.accept()
        log(f"Connection from {addr[0]}")
        try:
            receive_file(conn)
        except Exception as e:
            log(f"Error: {e}")
        finally:
            conn.close()

if __name__ == "__main__":
    main()
