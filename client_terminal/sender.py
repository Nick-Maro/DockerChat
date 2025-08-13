import socket
import os
import json
import base64
import threading
import time
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes

client_id = None
heartbeat_active = False
sock_global = None

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
    print("[CLIENT] Registration request sent")

def sign_message(private_key, message_bytes):
    signature = private_key.sign(
        message_bytes,
        padding.PKCS1v15(),
        hashes.SHA256()
    )
    return signature

def send_command_http(sock, command, private_key, host, port, extra_data=None):
    global client_id
    
    try:
        body_data = {
            "command": command,
            "client_id": client_id
        }
        
        if command.startswith("send_message:") or command.startswith("send_private:"):
            if command.startswith("send_message:"):
                message_text = command.split(":", 1)[1]
            else:
                parts = command.split(":", 2)
                if len(parts) >= 3:
                    message_text = parts[2]
                else:
                    message_text = ""
            
            if message_text:
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
        if not command == "heartbeat":
            print(f"[CLIENT] Command sent: {command}")
        
        return True
        
    except (ConnectionResetError, ConnectionAbortedError, OSError, BrokenPipeError) as e:
        print(f"[ERROR] Connection lost while sending command '{command}': {e}")
        return False
    except Exception as e:
        print(f"[ERROR] Error sending command '{command}': {e}")
        return False

def read_http_response(sock, show_output=True):
    response = b""
    headers_complete = False
    content_length = 0
    headers_end_pos = 0
    
    try:
        sock.settimeout(10.0)
        
        while not headers_complete:
            try:
                data = sock.recv(4096)
                if not data:
                    if show_output:
                        print("[DEBUG] Connection closed by server during header reading")
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
            except socket.timeout:
                if show_output:
                    print("[DEBUG] Timeout during header reading")
                break
            except (ConnectionResetError, ConnectionAbortedError, OSError) as e:
                if show_output:
                    print(f"[DEBUG] Connection lost during header reading: {e}")
                return b""

        if content_length > 0:
            body_received = len(response) - headers_end_pos
            
            while body_received < content_length:
                try:
                    remaining = content_length - body_received
                    chunk_size = min(4096, remaining)
                    data = sock.recv(chunk_size)
                    
                    if not data:
                        if show_output:
                            print(f"[DEBUG] Connection closed prematurely. Received {body_received}/{content_length} bytes of body")
                        break
                        
                    response += data
                    body_received += len(data)
                except socket.timeout:
                    if show_output:
                        print("[DEBUG] Timeout during body reading")
                    break
                except (ConnectionResetError, ConnectionAbortedError, OSError) as e:
                    if show_output:
                        print(f"[DEBUG] Connection lost during body reading: {e}")
                    return b""
        
    except Exception as e:
        if show_output:
            print(f"[DEBUG] General error during response reading: {e}")
        return b""
    finally:
        sock.settimeout(None)
    
    if response and show_output:
        response_str = response.decode('utf-8', errors='ignore')
        print(f"[CLIENT] Server response:")
        
        try:
            if "HTTP/1.1" in response_str and "\r\n\r\n" in response_str:
                json_part = response_str.split("\r\n\r\n", 1)[1].strip()
                response_data = json.loads(json_part)
                
                if "client_id" in response_data:
                    global client_id
                    client_id = response_data["client_id"]
                    print(f"[CLIENT] Assigned ID: {client_id}")
                    print(f"[CLIENT] Registration completed!")
                    
                    if "ttl_info" in response_data:
                        ttl_info = response_data["ttl_info"]
                        print(f"[CLIENT] TTL Config: Client {ttl_info.get('client_ttl_hours', 'N/A')}h, Messages {ttl_info.get('message_ttl_hours', 'N/A')}h")
                
                if "messages" in response_data:
                    messages = response_data["messages"]
                    print(f"[CLIENT] Found {len(messages)} messages in room")
                    for i, msg in enumerate(messages):
                        timestamp = msg.get("timestamp", "unknown")[:19].replace('T', ' ')
                        from_client = msg.get("from_client", "unknown")
                        text = msg.get("text", "")
                        
                        if from_client == client_id:
                            sender_label = "You"
                        else:
                            sender_label = from_client
                        
                        print(f"  [{i+1}] {timestamp} - {sender_label}: {text}")
                
                if "private_messages" in response_data:
                    messages = response_data["private_messages"]
                    print(f"[CLIENT] Found {len(messages)} private messages")
                    for i, msg in enumerate(messages):
                        timestamp = msg.get("timestamp", "unknown")[:19].replace('T', ' ')
                        direction = "📤" if msg.get("direction") == "sent" else "📥"
                        other_client = msg.get("to_client" if msg.get("direction") == "sent" else "from_client", "unknown")
                        text = msg.get("text", "")
                        read_status = "✓✓" if msg.get("read") else "✓"
                        
                        if other_client == client_id:
                            contact_label = "You"
                        else:
                            contact_label = other_client
                        
                        print(f"  [{i+1}] {direction} {timestamp} - {contact_label}: {text} {read_status}")
                
                if "rooms" in response_data:
                    rooms = response_data["rooms"]
                    print(f"[CLIENT] Available rooms: {len(rooms)}")
                    for room in rooms:
                        name = room.get("name", "unknown")
                        clients = room.get("clients", 0)
                        messages = room.get("messages", 0)
                        last_activity = room.get("last_activity", "")[:19].replace('T', ' ') if room.get("last_activity") else "N/A"
                        print(f"  - {name}: {clients} client(s), {messages} message(s) [last activity: {last_activity}]")
                
                if "clients" in response_data:
                    clients = response_data["clients"]
                    print(f"[CLIENT] Available clients: {len(clients)}")
                    for client in clients:
                        client_full = client.get("client_id", "unknown")
                        room = client.get("room_id") or "No room"
                        status = "Online" if client.get("online") else "Offline"
                        last_seen = client.get("last_seen", "")[:19].replace('T', ' ') if client.get("last_seen") else "N/A"
                        
                        if client_full == client_id:
                            client_label = f"{client_full} (You)"
                        else:
                            client_label = client_full
                        
                        print(f"  - {client_label} | {room} | {status} [last seen: {last_seen}]")
                
                if "message" in response_data and "client_id" not in response_data:
                    print(f"[SERVER] {response_data['message']}")
                        
        except json.JSONDecodeError as e:
            print(f"[DEBUG] JSON parsing error: {e}")
        except Exception as e:
            print(f"[DEBUG] General error: {e}")
    
    return response

def heartbeat_thread(sock, private_key, host, port):
    global heartbeat_active, client_id
    
    while heartbeat_active and client_id:
        try:
            time.sleep(1800)
            if heartbeat_active and client_id:
                send_command_http(sock, "heartbeat", private_key, host, port)
                read_http_response(sock, show_output=False)
        except Exception as e:
            print(f"[HEARTBEAT] Error: {e}")
            break

def show_help():
    print("""
Available commands:
j <room_name>         = Join room
s <message>           = Send message to room
p <client_id> <msg>   = Send private message (use full ID from 'c' command)
r                     = Read room messages
pm                    = Read private messages
l                     = List all rooms
c                     = List all clients (with full IDs)
e                     = Leave current room
h                     = Show this help
q                     = Quit program

Examples:
j general                                     = Join "general" room
s Hello everyone!                             = Send "Hello everyone!" to room
c                                            = See clients with full IDs
p dbb61c22-1234-5678-9abc-def012345678 Hi!   = Private message (copy/paste full ID)

NOTE: For private messages, always use the full ID shown by the 'c' command
    """)

def main():
    global client_id, heartbeat_active, sock_global
    
    host = input("Server host (default: localhost): ").strip() or "localhost"
    port_input = input("Port (default: 5001): ").strip()
    port = int(port_input) if port_input else 5001

    private_key, public_key = generate_or_load_keys()
    print("[CLIENT] Public key generated/loaded")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock_global = sock
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 65536)
        
        try:
            sock.connect((host, port))
            print(f"[CLIENT] Connected to {host}:{port}")
        except Exception as e:
            print(f"[ERROR] Cannot connect: {e}")
            return

        try:
            send_public_key(sock, public_key, host, port)
            response = read_http_response(sock)
            if not response:
                print("[ERROR] No response from server during registration")
                return
        except Exception as e:
            print(f"[ERROR] Error during registration: {e}")
            return
        
        if not client_id:
            print("[ERROR] Registration failed! Client ID not received")
            return
        
        print(f"[CLIENT] Successfully registered! ID: {client_id}")
        
        heartbeat_active = True
        heartbeat_t = threading.Thread(target=heartbeat_thread, args=(sock, private_key, host, port))
        heartbeat_t.daemon = True
        heartbeat_t.start()
        print("[CLIENT] Heartbeat activated (every 30 minutes)")
        
        show_help()

        while True:
            try:
                command = input("\n> ").strip()
                
                if command == 'q':
                    print("[CLIENT] Closing connection...")
                    if send_command_http(sock, f"disconnect", private_key, host, port):
                        response = read_http_response(sock)
                        if not response:
                            print("[ERROR] Client not removed from clients list")
                    heartbeat_active = False
                    sock.close()
                    break
                elif command == 'h':
                    show_help()
                elif not client_id:
                    print("[ERROR] Client not registered! Restart the program")
                    continue
                elif command.startswith('j '):
                    room_name = command[2:].strip()
                    if room_name:
                        if send_command_http(sock, f"join_room:{room_name}", private_key, host, port):
                            response = read_http_response(sock)
                            if not response:
                                print("[ERROR] Connection lost, retry or restart client")
                    else:
                        print("[CLIENT] Specify room name: j <room_name>")
                elif command.startswith('s '):
                    message = command[2:].strip()
                    if message:
                        if send_command_http(sock, f"send_message:{message}", private_key, host, port):
                            response = read_http_response(sock)
                            if not response:
                                print("[ERROR] Connection lost, retry or restart client")
                    else:
                        print("[CLIENT] Specify message: s <message>")
                elif command.startswith('p '):
                    parts = command[2:].strip().split(' ', 1)
                    if len(parts) == 2:
                        target_client, message = parts
                        if send_command_http(sock, f"send_private:{target_client}:{message}", private_key, host, port):
                            response = read_http_response(sock)
                            if not response:
                                print("[ERROR] Connection lost, retry or restart client")
                    else:
                        print("[CLIENT] Format: p <client_id> <message>")
                        print("[CLIENT] Use 'c' to see available clients")
                elif command == 'r':
                    if send_command_http(sock, "get_messages", private_key, host, port):
                        response = read_http_response(sock)
                        if not response:
                            print("[ERROR] Connection lost, retry or restart client")
                elif command == 'pm':
                    if send_command_http(sock, "get_private_messages", private_key, host, port):
                        response = read_http_response(sock)
                        if not response:
                            print("[ERROR] Connection lost, retry or restart client")
                elif command == 'l':
                    if send_command_http(sock, "list_rooms", private_key, host, port):
                        response = read_http_response(sock)
                        if not response:
                            print("[ERROR] Connection lost, retry or restart client")
                elif command == 'c':
                    if send_command_http(sock, "list_clients", private_key, host, port):
                        response = read_http_response(sock)
                        if not response:
                            print("[ERROR] Connection lost, retry or restart client")
                elif command == 'e':
                    if send_command_http(sock, "leave_room", private_key, host, port):
                        response = read_http_response(sock)
                        if not response:
                            print("[ERROR] Connection lost, retry or restart client")
                else:
                    print("[CLIENT] Invalid command. Type 'h' for help")
                    
            except KeyboardInterrupt:
                print("\n[CLIENT] User interruption, closing...")
                if send_command_http(sock, f"disconnect", private_key, host, port):
                    response = read_http_response(sock)
                    if not response:
                        print("[ERROR] Client not removed from clients list")
                heartbeat_active = False
                sock.close()
                break
            except Exception as e:
                print(f"[ERROR] {e}")

if __name__ == "__main__":
    main()