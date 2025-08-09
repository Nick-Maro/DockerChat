import socket
import os
import json

def send_file_http(sock, filepath, host, port):
    if not os.path.isfile(filepath):
        print(f"Errore: file '{filepath}' non trovato.")
        return
    
    with open(filepath, "rb") as f:
        file_data = f.read()
    

    import base64
    file_b64 = base64.b64encode(file_data).decode('utf-8')
    filename = os.path.basename(filepath)
    
    body = json.dumps({
        "command": f"upload_file:{filename}",
        "data": file_b64
    })
    

    http_request = f"""POST /command HTTP/1.1\r
Host: {host}:{port}\r
Content-Type: application/json\r
Content-Length: {len(body.encode())}\r
Connection: keep-alive\r
\r
{body}"""
    
    sock.sendall(http_request.encode())
    print(f"[CLIENT] File '{filepath}' inviato via HTTP POST ({len(file_data)} bytes).")

def send_message_http(sock, message, host, port):

    body = json.dumps({
        "command": message
    })
    

    http_request = f"""POST /command HTTP/1.1\r
Host: {host}:{port}\r
Content-Type: application/json\r
Content-Length: {len(body.encode())}\r
Connection: keep-alive\r
\r
{body}"""
    
    sock.sendall(http_request.encode())
    print(f"[CLIENT] Messaggio inviato via HTTP POST: {message}")

def read_http_response(sock):
    response = b""
    while True:
        data = sock.recv(1024)
        if not data:
            break
        response += data

        if b"\r\n\r\n" in response:

            break
    
    if response:
        response_str = response.decode('utf-8', errors='ignore')
        print(f"[CLIENT] Risposta del server:")
        print(response_str)
    return response

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
                send_file_http(sock, filepath, host, port)
                read_http_response(sock)
            elif scelta == 'm':
                message = input("Messaggio: ")
                send_message_http(sock, message, host, port)
                read_http_response(sock)
            else:
                print("[CLIENT] Comando non valido.")

if __name__ == "__main__":
    main()