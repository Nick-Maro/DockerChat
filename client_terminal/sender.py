import asyncio
import json
import base64
import os
import sys
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes
from websockets.exceptions import ConnectionClosed, WebSocketException

client_id = None
heartbeat_active = False
websocket_connection = None
main_tasks = []

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

def sign_message(private_key, message_bytes):
    signature = private_key.sign(message_bytes, padding.PKCS1v15(), hashes.SHA256())
    return signature

async def send_public_key(websocket, public_key):
    global client_id
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )

    message = {
        "command": "upload_public_key",
        "public_key": public_pem.decode('utf-8'),
        "client_id": client_id
    }

    await websocket.send(json.dumps(message))
    print("[CLIENT] Registration request sent")

async def send_command(websocket, command, private_key, extra_data=None):
    global client_id

    try:
        message_data = {
            "command": command,
            "client_id": client_id
        }

        if command.startswith("send_message:") or command.startswith("send_private:"):
            if command.startswith("send_message:"):
                message_text = command.split(":", 1)[1]
            else:
                parts = command.split(":", 2)
                message_text = ""
                if len(parts) >= 3:
                    message_text = parts[2]
            if message_text:
                message_bytes = message_text.encode('utf-8')
                signature = sign_message(private_key, message_bytes)
                signature_b64 = base64.b64encode(signature).decode('utf-8')
                message_data["signature"] = signature_b64
        if extra_data:
            message_data.update(extra_data)

        await websocket.send(json.dumps(message_data))
        return True
    except (ConnectionClosed, WebSocketException) as e:
        print(f"\n[ERROR] WebSocket connection lost while sending command '{command}': {e}")
        return False
    except Exception as e:
        print(f"\n[ERROR] Error sending command '{command}': {e}")
        return False

def process_response(response_data, show_output=True):
    global client_id

    if not show_output:
        return

    try:
        sys.stdout.write('\r\033[K')

        if "client_id" in response_data:
            client_id = response_data["client_id"]
            print(f"[CLIENT] Assigned ID: {client_id}")
            print(f"[CLIENT] Registration completed!")

            if "ttl_info" in response_data:
                ttl_info = response_data["ttl_info"]
                print(f"[CLIENT] TTL Config: Client {ttl_info.get('client_ttl_hours', 'N/A')}h, Messages {ttl_info.get('message_ttl_hours', 'N/A')}h")
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
        if "messages" in response_data:
            messages = response_data["messages"]
            print(f"[CLIENT] Found {len(messages)} messages in room")
            for i, msg in enumerate(messages):
                timestamp = msg.get("timestamp", "unknown")[:19].replace('T', ' ')
                from_client = msg.get("from_client", "unknown")
                text = msg.get("text", "")
                sender_label = "You" if from_client == client_id else from_client
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
                contact_label = "You" if other_client == client_id else other_client
                print(f"  [{i+1}] {direction} {timestamp} - {contact_label}: {text} {read_status}")
        if "message" in response_data and "client_id" not in response_data:
            print(f"[SERVER] {response_data['message']}")
        if "error" in response_data:
            print(f"[ERROR] {response_data['error']}")
        if heartbeat_active:
            print("> ", end="", flush=True)
    except Exception as e:
        print(f"\n[DEBUG] Error processing response: {e}")
        if heartbeat_active:
            print("> ", end="", flush=True)

async def heartbeat_task(websocket, private_key):
    global heartbeat_active, client_id

    while heartbeat_active:
        try:
            await asyncio.sleep(1800)  # 30 minutes
            if heartbeat_active and client_id and websocket and not websocket.closed:
                await send_command(websocket, "heartbeat", private_key)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[HEARTBEAT] Error: {e}")
            break

async def message_listener(websocket):
    try:
        async for message in websocket:
            try:
                response_data = json.loads(message)
                process_response(response_data, show_output=True)
            except json.JSONDecodeError as e:
                print(f"\n[ERROR] Failed to parse server message: {e}")
    except asyncio.CancelledError:
        pass
    except ConnectionClosed:
        print("\n[INFO] WebSocket connection closed by server.")
        await quit_client(None, None, force_quit=True)
    except Exception as e:
        print(f"\n[ERROR] Message listener error: {e}")

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
""")

async def handle_user_input(websocket, private_key):
    loop = asyncio.get_running_loop()
    while heartbeat_active:
        try:
            command = await asyncio.to_thread(sys.stdin.readline)
            command = command.strip()
            if command:
                await process_command(command, websocket, private_key)
        except (EOFError, KeyboardInterrupt):
            print("\n[CLIENT] Quitting input...")
            await quit_client(websocket, private_key)
            break
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"\n[ERROR] Input error: {e}")

async def process_command(command, websocket, private_key):
    global client_id, heartbeat_active

    if not client_id:
        print("[ERROR] Client not registered! Restart the program")
        return

    match command.split(' ', 1):
        case ['q']:
            await quit_client(websocket, private_key)
        case ['h']:
            show_help()
            print("> ", end="", flush=True)
        case ['j', room_name]:
            await send_command(websocket, f"join_room:{room_name}", private_key)
        case ['s', message]:
            await send_command(websocket, f"send_message:{message}", private_key)
        case ['p', rest] if rest:
            parts = rest.split(' ', 1)
            if len(parts) == 2:
                await send_command(websocket, f"send_private:{parts[0]}:{parts[1]}", private_key)
            else:
                print("[CLIENT] Format: p <client_id> <message>. Use 'c' to see client IDs.")
                print("> ", end="", flush=True)
        case ['r']:
            await send_command(websocket, "get_messages", private_key)
        case ['pm']:
            await send_command(websocket, "get_private_messages", private_key)
        case ['l']:
            await send_command(websocket, "list_rooms", private_key)
        case ['c']:
            await send_command(websocket, "list_clients", private_key)
        case ['e']:
            await send_command(websocket, "leave_room", private_key)
        case _:
            if command.strip():
                print("[CLIENT] Invalid command. Type 'h' for help")
                print("> ", end="", flush=True)

async def quit_client(websocket, private_key, force_quit=False):
    global heartbeat_active, main_tasks
    if not heartbeat_active and not force_quit:
        return

    print("\n[CLIENT] Closing connection...")
    heartbeat_active = False

    if websocket:
        try:
            await send_command(websocket, "disconnect", private_key)
            await asyncio.sleep(0.1)
            await websocket.close()
        except Exception as e:
            print(f"[ERROR] Error during disconnect: {e}")

    for task in main_tasks:
        if not task.done():
            task.cancel()

async def main():
    global client_id, heartbeat_active, websocket_connection, main_tasks

    host = input("Server host (default: api.localhost): ").strip() or "api.localhost"
    port_input = input("Port (default: 5000): ").strip()
    port = int(port_input) if port_input else 5001

    private_key, public_key = generate_or_load_keys()
    print("[CLIENT] Public key generated/loaded")

    uri = f"ws://{host}:{port}"

    try:
        async with websockets.connect(uri) as websocket:
            websocket_connection = websocket
            print(f"[CLIENT] Connected to {uri}")
            await send_public_key(websocket, public_key)
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                response_data = json.loads(response)
                process_response(response_data)
                if not client_id:
                    print("[ERROR] Registration failed! Client ID not received")
                    return
            except asyncio.TimeoutError:
                print("[ERROR] Registration timeout")
                return
            except Exception as e:
                print(f"[ERROR] Registration error: {e}")
                return

            heartbeat_active = True
            show_help()
            print("> ", end="", flush=True)

            listener_task = asyncio.create_task(message_listener(websocket))
            heartbeat_task_ref = asyncio.create_task(heartbeat_task(websocket, private_key))
            input_task = asyncio.create_task(handle_user_input(websocket, private_key))
            main_tasks = [listener_task, heartbeat_task_ref, input_task]

            await asyncio.gather(*main_tasks, return_exceptions=True)
    except ConnectionRefusedError:
        print(f"[ERROR] Cannot connect to {uri} - connection refused")
    except Exception as e:
        print(f"[ERROR] Connection error: {e}")
    finally:
        print("[CLIENT] Program exited.")

def run_client():
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[CLIENT] Program interrupted by user.")

if __name__ == "__main__":
    try:
        import websockets
    except ImportError:
        print("[ERROR] websockets package not found. Install it with: pip install websockets")
        exit(1)
    run_client()