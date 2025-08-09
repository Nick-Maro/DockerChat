import socket
import os

def send_file(sock, filepath):
    if not os.path.isfile(filepath):
        print(f"Errore: file '{filepath}' non trovato.")
        return

    with open(filepath, "rb") as f:
        file_data = f.read()

    file_size = len(file_data)
    sock.sendall(file_size.to_bytes(8, byteorder='big'))
    sock.sendall(file_data)
    print(f"[CLIENT] File '{filepath}' inviato ({file_size} bytes).")

def send_message(sock, message):
    sock.sendall(message.encode())
    print(f"[CLIENT] Messaggio inviato: {message}")

def main():
    host = input("Host del server: ")
    port = int(input("Porta: "))

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.connect((host, port))
        print(f"[CLIENT] Connesso a {host}:{port}")

        while True:
            scelta = input("f = invia file | m = invia messaggio | q = esci: ").lower()
            if scelta == 'q':
                print("[CLIENT] Chiusura connessione...")
                break
            elif scelta == 'f':
                filepath = input("Percorso file: ")
                send_file(sock, filepath)
            elif scelta == 'm':
                message = input("Messaggio: ")
                send_message(sock, message)
            else:
                print("[CLIENT] Comando non valido.")

if __name__ == "__main__":
    main()
