from flask import Flask, request, jsonify
import uuid
import json
import redis
from datetime import datetime, timedelta
from json import JSONDecodeError

app = Flask(__name__)


CLIENT_TTL = 3600  # 1 hour
ROOM_TTL = 7200    # 2 hours
MESSAGE_TTL = 86400  # 24 hours

try:
    redis_client = redis.Redis(host='redis', port=6379, db=0, decode_responses=True)
    redis_client.ping()
    print("Connected to Redis")
except (ConnectionRefusedError, TimeoutError):
    print("Redis unavailable, use local storage")
    redis_client = None

local_rooms = {}
local_clients = {}
local_private_messages = {}

def is_expired(timestamp_iso, ttl_seconds):

    try:
        timestamp = datetime.fromisoformat(timestamp_iso)
        return datetime.now() - timestamp > timedelta(seconds=ttl_seconds)
    except (KeyError, ValueError):
        return True

def clean_expired_data():
 
    clients = get_clients()
    rooms = get_rooms()
    private_msgs = get_private_messages()
    

    expired_clients = []
    for client_id, client_data in clients.items():
        if is_expired(client_data.get("last_seen", ""), CLIENT_TTL):
            expired_clients.append(client_id)
    
    for client_id in expired_clients:
        del clients[client_id]
   
        for room_id, room_data in rooms.items():
            if client_id in room_data.get("clients", {}):
                del room_data["clients"][client_id]
    

    for room_id, room_data in rooms.items():
        messages = room_data.get("messages", [])
        room_data["messages"] = [
            msg for msg in messages 
            if not is_expired(msg.get("timestamp", ""), MESSAGE_TTL)
        ]
    

    empty_rooms = []
    for room_id, room_data in rooms.items():
        if (not room_data.get("clients") or 
            is_expired(room_data.get("last_activity", ""), ROOM_TTL)):
            empty_rooms.append(room_id)
    
    for room_id in empty_rooms:
        del rooms[room_id]
    

    expired_private = []
    for msg_id, msg_data in private_msgs.items():
        if is_expired(msg_data.get("timestamp", ""), MESSAGE_TTL):
            expired_private.append(msg_id)
    
    for msg_id in expired_private:
        del private_msgs[msg_id]
    
    set_clients(clients)
    set_rooms(rooms)
    set_private_messages(private_msgs)

def get_clients():
    if redis_client:
        try:
            clients_data = redis_client.get('clients')
            return json.loads(clients_data) if clients_data else {}
        except JSONDecodeError:
            return {}
    return local_clients


def set_clients(clients):
    if redis_client:
        try:
            redis_client.set('clients', json.dumps(clients))
        except Exception as e:
            print(f"[ERROR] Failed to update Redis clients: {e}")
    to_remove = set(local_clients.keys()) - set(clients.keys())
    for client_id in to_remove:
        del local_clients[client_id]
    local_clients.update(clients)

def get_rooms():
    if redis_client:
        try:
            rooms_data = redis_client.get('rooms')
            return json.loads(rooms_data) if rooms_data else {}
        except JSONDecodeError:
            return {}
    return local_rooms

def set_rooms(rooms):
    if redis_client:
        try:
            redis_client.set('rooms', json.dumps(rooms))
        except (ConnectionError, TimeoutError):
            pass
    local_rooms.update(rooms)

def get_private_messages():
    if redis_client:
        try:
            private_data = redis_client.get('private_messages')
            return json.loads(private_data) if private_data else {}
        except JSONDecodeError:
            return {}
    return local_private_messages

def set_private_messages(private_msgs):
    if redis_client:
        try:
            redis_client.set('private_messages', json.dumps(private_msgs))
        except (ConnectionError, TimeoutError):
            pass
    local_private_messages.update(private_msgs)

def add_message_to_room(room_id, message):
    rooms = get_rooms()
    if room_id not in rooms:
        rooms[room_id] = {
            "clients": {}, 
            "messages": [],
            "created_at": datetime.now().isoformat(),
            "last_activity": datetime.now().isoformat()
        }
    
    rooms[room_id]["messages"].append(message)
    rooms[room_id]["last_activity"] = datetime.now().isoformat()
    set_rooms(rooms)

def add_client_to_room(room_id, client_id, client_data):
    rooms = get_rooms()
    if room_id not in rooms:
        rooms[room_id] = {
            "clients": {}, 
            "messages": [],
            "created_at": datetime.now().isoformat(),
            "last_activity": datetime.now().isoformat()
        }
    
    rooms[room_id]["clients"][client_id] = client_data
    rooms[room_id]["last_activity"] = datetime.now().isoformat()
    set_rooms(rooms)

def add_private_message(from_client, to_client, message_text, signature=None):
    private_msgs = get_private_messages()
    message_id = str(uuid.uuid4())
    
    message = {
        "id": message_id,
        "from_client": from_client,
        "to_client": to_client,
        "text": message_text,
        "signature": signature,
        "timestamp": datetime.now().isoformat(),
        "read": False
    }
    
    private_msgs[message_id] = message
    set_private_messages(private_msgs)
    return message_id

@app.route("/command", methods=["POST"])
def receive_http_command():

    clean_expired_data()
    
    data = request.get_json()
    
    if not data or "command" not in data:
        return jsonify({"error": "Missing 'command' in JSON"}), 400
    
    command = data["command"]
    public_key = data.get("public_key")
    client_id = data.get("client_id")
    
    debug_info = {
        "server_instance": f"Flask-{id(app)}",
        "redis_available": redis_client is not None,
        "command": command,
        "client_id": client_id
    }
    
    if command == "upload_public_key" and public_key:
        if not client_id:
            client_id = str(uuid.uuid4())
        
        clients = get_clients()
        clients[client_id] = {
            "public_key": public_key,
            "room_id": None,
            "last_seen": datetime.now().isoformat(),
            "created_at": datetime.now().isoformat()
        }
        set_clients(clients)
        
        return jsonify({
            "command": command,
            "message": "Client registered with success!",
            "client_id": client_id,
            "status": "registered",
            "ttl_info": {
                "client_ttl_hours": CLIENT_TTL // 3600,
                "message_ttl_hours": MESSAGE_TTL // 3600
            },
            "debug": debug_info
        })
    
    elif command.startswith("join_room:"):
        room_name = command.split(":", 1)[1]
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Unregistered client"}), 400

        clients[client_id]["room_id"] = room_name
        clients[client_id]["last_seen"] = datetime.now().isoformat()
        set_clients(clients)
        
        add_client_to_room(room_name, client_id, {
            "public_key": clients[client_id]["public_key"],
            "last_seen": datetime.now().isoformat()
        })
        
        rooms = get_rooms()
        return jsonify({
            "command": command,
            "message": f"Joined room '{room_name}'",
            "room_name": room_name,
            "clients_in_room": len(rooms.get(room_name, {}).get("clients", {})),
            "debug": debug_info
        })
    
    elif command.startswith("send_message:"):
        message_text = command.split(":", 1)[1]
        signature = data.get("signature")
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Unregistered client"}), 400
        
        clients[client_id]["last_seen"] = datetime.now().isoformat()
        set_clients(clients)
        
        room_id = clients[client_id]["room_id"]
        if not room_id:
            return jsonify({"error": "You aren't connected to any room"}), 400
        
        message = {
            "from_client": client_id,
            "text": message_text,
            "signature": signature,
            "timestamp": datetime.now().isoformat(),
            "public_key": clients[client_id]["public_key"]
        }
        add_message_to_room(room_id, message)
        
        return jsonify({
            "command": command,
            "message": f"Message sent in room '{room_id}'",
            "room_name": room_id,
            "message_text": message_text,
            "debug": debug_info
        })
    
    elif command.startswith("send_private:"):
        
        parts = command.split(":", 2)
        if len(parts) != 3:
            return jsonify({"error": "Command format: send_private:CLIENT_ID:MESSAGE"}), 400
        
        to_client_id = parts[1]
        message_text = parts[2]
        signature = data.get("signature")
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Unregistered client"}), 400
        
        if to_client_id not in clients:
            return jsonify({"error": "Recipient Client not found"}), 400
        
        
        clients[client_id]["last_seen"] = datetime.now().isoformat()
        set_clients(clients)
        
        message_id = add_private_message(client_id, to_client_id, message_text, signature)
        
        return jsonify({
            "command": command,
            "message": f"Private message sent to {to_client_id}",
            "message_id": message_id,
            "to_client": to_client_id,
            "debug": debug_info
        })
    
    elif command == "get_private_messages":
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Unregistered client"}), 400
        
       
        clients[client_id]["last_seen"] = datetime.now().isoformat()
        set_clients(clients)
        
        private_msgs = get_private_messages()
        my_messages = []
        
        for msg_id, msg_data in private_msgs.items():
            if msg_data["to_client"] == client_id or msg_data["from_client"] == client_id:
                my_messages.append({
                    "id": msg_id,
                    "from_client": msg_data["from_client"],
                    "to_client": msg_data["to_client"],
                    "text": msg_data["text"],
                    "timestamp": msg_data["timestamp"],
                    "read": msg_data["read"],
                    "direction": "received" if msg_data["to_client"] == client_id else "sent"
                })
        
       
        my_messages.sort(key=lambda x: x["timestamp"])
        
        
        for msg in my_messages:
            if msg["direction"] == "received" and not msg["read"]:
                private_msgs[msg["id"]]["read"] = True
        
        set_private_messages(private_msgs)
        
        return jsonify({
            "command": command,
            "private_messages": my_messages,
            "total_messages": len(my_messages),
            "debug": debug_info
        })
    
    elif command == "get_messages":
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Unregistered client"}), 400
        
        
        clients[client_id]["last_seen"] = datetime.now().isoformat()
        set_clients(clients)
        
        room_id = clients[client_id]["room_id"]
        if not room_id:
            return jsonify({"error": "You're not in any room"}), 400
        
        rooms = get_rooms()
        messages = rooms.get(room_id, {}).get("messages", [])
        
        return jsonify({
            "command": command,
            "room_name": room_id,
            "messages": messages,
            "total_messages": len(messages),
            "debug": debug_info
        })
    
    elif command == "list_clients":
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Unregistered client"}), 400
        
    
        clients[client_id]["last_seen"] = datetime.now().isoformat()
        set_clients(clients)
        
        client_list = []
        for cid, client_data in clients.items():
            if cid != client_id:  
                client_list.append({
                    "client_id": cid,
                    "room_id": client_data.get("room_id"),
                    "last_seen": client_data.get("last_seen"),
                    "online": not is_expired(client_data.get("last_seen", ""), CLIENT_TTL)
                })
        
        return jsonify({
            "command": command,
            "message": "List of available clients",
            "clients": client_list,
            "total_clients": len(client_list),
            "debug": debug_info
        })
    
    elif command == "list_rooms":
        rooms = get_rooms()
        room_list = []
        for room_name, room_data in rooms.items():
            room_list.append({
                "name": room_name,
                "clients": len(room_data.get("clients", {})),
                "messages": len(room_data.get("messages", [])),
                "created_at": room_data.get("created_at"),
                "last_activity": room_data.get("last_activity")
            })
        
        return jsonify({
            "command": command,
            "message": "List of available rooms",
            "rooms": room_list,
            "debug": debug_info
        })
    
    elif command == "leave_room":
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Unregistered client"}), 400
        
        room_id = clients[client_id]["room_id"]
        if room_id:
            rooms = get_rooms()
            if room_id in rooms and client_id in rooms[room_id].get("clients", {}):
                del rooms[room_id]["clients"][client_id]
                rooms[room_id]["last_activity"] = datetime.now().isoformat()
                set_rooms(rooms)
            
            clients[client_id]["room_id"] = None
            clients[client_id]["last_seen"] = datetime.now().isoformat()
            set_clients(clients)
            
            return jsonify({
                "command": command,
                "message": f"Left the room '{room_id}'",
                "debug": debug_info
            })
    
    elif command == "heartbeat":
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Unregistered client"}), 400

        clients[client_id]["last_seen"] = datetime.now().isoformat()
        set_clients(clients)
        
        return jsonify({
            "command": command,
            "message": "Heartbeat received",
            "client_status": "alive",
            "debug": debug_info
        })
    elif command == "disconnect":
        clients = get_clients()
        if not client_id or client_id not in clients:
            return jsonify({"error": "Unregistered client"}), 400

        rooms = get_rooms()
        for room_id, room_data in rooms.items():
            if client_id in room_data.get("clients", {}):
                del room_data["clients"][client_id]
                room_data["last_activity"] = datetime.now().isoformat()
        set_rooms(rooms)

        del clients[client_id]
        set_clients(clients)

        return jsonify({
            "command": command,
            "message": f"Client {client_id} disconnected and removed",
            "debug": {"client_id": client_id}
        })
    
    return jsonify({
        "command": command, 
        "message": "Unknown command",
        "available_commands": [
            "upload_public_key",
            "join_room:ROOM_NAME",
            "send_message:TEXT",
            "send_private:CLIENT_ID:MESSAGE",
            "get_messages",
            "get_private_messages",
            "list_rooms",
            "list_clients",
            "leave_room",
            "heartbeat"
        ],
        "debug": debug_info
    })

@app.route("/status", methods=["GET"])
def server_status():
    clean_expired_data()
    
    clients = get_clients()
    rooms = get_rooms()
    private_msgs = get_private_messages()
    

    online_clients = sum(1 for client_data in clients.values() 
                        if not is_expired(client_data.get("last_seen", ""), CLIENT_TTL))
    
    return jsonify({
        "server_instance": f"Flask-{id(app)}",
        "redis_available": redis_client is not None,
        "total_clients": len(clients),
        "online_clients": online_clients,
        "total_rooms": len(rooms),
        "total_private_messages": len(private_msgs),
        "ttl_config": {
            "client_ttl_seconds": CLIENT_TTL,
            "room_ttl_seconds": ROOM_TTL,
            "message_ttl_seconds": MESSAGE_TTL
        },
        "rooms": {name: {
            "clients": len(data.get("clients", {})), 
            "messages": len(data.get("messages", [])),
            "last_activity": data.get("last_activity")
        } for name, data in rooms.items()}
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)