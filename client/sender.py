import socket
import os
import json
import base64
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes


client_id = None

def generate_or_load_keys():
    priv_path = "private_key.pem"
    pub_path = "public_key.pem"

    if os.path.isfile(priv_path) and os.path.isfile(pub_path):
        with open(priv_path, "rb") as f:
            private_key = serialization.load_pem_private_key(f.read(), password=None)
        with open(pub_path, "rb") as f:
            public_key = serialization.load_pem_public_key(f.read())
    else:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_key = private_key.public_key()

        with open(priv_path, "wb") as f:
            f.write(private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            ))
        with open(pub_path, "wb") as f:
            f.write(public_key.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo
            ))

    return private_key, public_key

def send_public_key(sock, public_key, host, port):
    global client_id
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    body = json.dumps({
        "command": "upload_public_key",
        "public_key": public_pem.decode('utf-8'),
        "client_id": client_id
    })
    http_request = f"""POST /command HTTP/1.1\r
Host: {host}:{port}\r
Content-Type: application/json\r
Content-Length: {len(body.encode())}\r
Connection: keep-alive\r
\r
{body}"""
    sock.sendall(http_request.encode())
    print("[CLIENT] Registrazione client inviata.")

def sign_message(private_key, message_bytes):
    signature = private_key.sign(
        message_bytes,
        padding.PKCS1v15(),
        hashes.SHA256()
    )
    return signature

def send_command_http(sock, command, private_key, host, port, extra_data=None):
    global client_id
    
    body_data = {
        "command": command,
        "client_id": client_id
    }
    

    if command.startswith("send_message:"):
        message_text = command.split(":", 1)[1]
        message_bytes = message_text.encode('utf-8')
        signature = sign_message(private_key, message_bytes)
        signature_b64 = base64.b64encode(signature).decode('utf-8')
        body_data["signature"] = signature_b64
    

    if extra_data:
        body_data.update(extra_data)
    
    body = json.dumps(body_data)
    
    http_request = f"""POST /command HTTP/1.1\r
Host: {host}:{port}\r
Content-Type: application/json\r
Content-Length: {len(body.encode())}\r
Connection: keep-alive\r
\r
{body}"""
    
    sock.sendall(http_request.encode())
    print(f"[CLIENT] Comando inviato: {command}")

def read_http_response(sock):

    response = b""
    headers_complete = False
    content_length = 0
    headers_end_pos = 0
    

    while not headers_complete:
        data = sock.recv(4096)
        if not data:
            break
        response += data
        
        if b"\r\n\r\n" in response:
            headers_complete = True
            headers_end_pos = response.find(b"\r\n\r\n") + 4
            

            headers = response[:headers_end_pos].decode('utf-8', errors='ignore')
            

            for line in headers.split('\r\n'):
                if line.lower().startswith('content-length:'):
                    content_length = int(line.split(':', 1)[1].strip())
                    break
    

    if content_length > 0:
        body_received = len(response) - headers_end_pos
        
        while body_received < content_length:
            remaining = content_length - body_received
            chunk_size = min(4096, remaining)
            data = sock.recv(chunk_size)
            
            if not data:
                print(f"[DEBUG] Connessione chiusa prematuramente. Ricevuti {body_received}/{content_length} bytes del body")
                break
                
            response += data
            body_received += len(data)
    
    if response:
        response_str = response.decode('utf-8', errors='ignore')
        print(f"[CLIENT] Risposta del server:")
        print(f"[DEBUG] Dimensione totale risposta: {len(response)} bytes")
        

        if len(response_str) > 500:
            print(response_str[:500] + "... [TRONCATO PER VISUALIZZAZIONE]")
        else:
            print(response_str)
        

        try:
            if "HTTP/1.1" in response_str and "\r\n\r\n" in response_str:
                json_part = response_str.split("\r\n\r\n", 1)[1].strip()
                print(f"[DEBUG] Dimensione JSON: {len(json_part)} caratteri")
                
                response_data = json.loads(json_part)
                

                if "client_id" in response_data:
                    global client_id
                    client_id = response_data["client_id"]
                    print(f"[CLIENT]  ID assegnato: {client_id}")
                    print(f"[CLIENT]  Registrazione completata!")
                

                if "messages" in response_data:
                    messages = response_data["messages"]
                    print(f"[CLIENT] 📨 Trovati {len(messages)} messaggi nella stanza")
                    for i, msg in enumerate(messages):
                        timestamp = msg.get("timestamp", "sconosciuto")
                        from_client = msg.get("from_client", "sconosciuto")[:8] + "..."
                        text = msg.get("text", "")
                        print(f"  [{i+1}] {timestamp} - {from_client}: {text}")
                

                if "rooms" in response_data:
                    rooms = response_data["rooms"]
                    print(f"[CLIENT] Stanze disponibili: {len(rooms)}")
                    for room in rooms:
                        name = room.get("name", "sconosciuto")
                        clients = room.get("clients", 0)
                        messages = room.get("messages", 0)
                        print(f"  - {name}: {clients} client(i), {messages} messaggio(i)")
                        
        except json.JSONDecodeError as e:
            print(f"[DEBUG] Errore parsing JSON: {e}")
            print(f"[DEBUG] JSON problematico (primi 200 char): {json_part[:200] if 'json_part' in locals() else 'N/A'}")
        except Exception as e:
            print(f"[DEBUG] Errore generale: {e}")
    
    return response

def show_help():
    print("""
Comandi disponibili:
j <nome_stanza>  = Entra nella stanza
s <messaggio>    = Invia messaggio nella stanza
r                = Leggi messaggi della stanza
l                = Lista tutte le stanze
e                = Esci dalla stanza corrente
h                = Mostra questo aiuto
q                = Esci dal programma
    """)

def main():
    global client_id
    
    host = input("Host del server: ")
    port = int(input("Porta: "))

    private_key, public_key = generate_or_load_keys()
    print("[CLIENT] Chiave pubblica generata/caricata")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:

        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 65536)
        
        sock.connect((host, port))
        print(f"[CLIENT] Connesso a {host}:{port}")


        send_public_key(sock, public_key, host, port)
        read_http_response(sock)
        

        if not client_id:
            print("[ERRORE] Registrazione fallita! Client ID non ricevuto.")
            print("Riavvia il client e riprova.")
            return
        
        print(f"[CLIENT] Registrato con successo! ID: {client_id}")
        show_help()

        while True:
            comando = input("\n> ").strip()
            
            if comando == 'q':
                print("[CLIENT] Chiusura connessione...")
                break
            elif comando == 'h':
                show_help()
            elif not client_id:
                print("[ERRORE] Client non registrato! Riavvia il programma.")
                continue
            elif comando.startswith('j '):
                room_name = comando[2:].strip()
                if room_name:
                    send_command_http(sock, f"join_room:{room_name}", private_key, host, port)
                    read_http_response(sock)
                else:
                    print("[CLIENT] Specifica il nome della stanza: j <nome_stanza>")
            elif comando.startswith('s '):
                message = comando[2:].strip()
                if message:
                    send_command_http(sock, f"send_message:{message}", private_key, host, port)
                    read_http_response(sock)
                else:
                    print("[CLIENT] Specifica il messaggio: s <messaggio>")
            elif comando == 'r':
                send_command_http(sock, "get_messages", private_key, host, port)
                read_http_response(sock)
            elif comando == 'l':
                send_command_http(sock, "list_rooms", private_key, host, port)
                read_http_response(sock)
            elif comando == 'e':
                send_command_http(sock, "leave_room", private_key, host, port)
                read_http_response(sock)
            else:
                print("[CLIENT] Comando non valido. Digita 'h' per l'aiuto.")

if __name__ == "__main__":
    main()