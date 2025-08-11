from flask import Flask, request, jsonify
import uuid
import json
import redis
from datetime import datetime

app = Flask(__name__)


try:
    redis_client = redis.Redis(host='redis', port=6379, db=0, decode_responses=True)
    redis_client.ping()
    print("Connesso a Redis")
except:
    print("Redis non disponibile, uso storage locale")
    redis_client = None


local_rooms = {}
local_clients = {}

def get_clients():
    if redis_client:
        try:
            clients_data = redis_client.get('clients')
            return json.loads(clients_data) if clients_data else {}
        except:
            return {}
    return local_clients

def set_clients(clients):
    if redis_client:
        try:
            redis_client.set('clients', json.dumps(clients))
        except:
            pass
    local_clients.update(clients)

def get_rooms():
    if redis_client:
        try:
            rooms_data = redis_client.get('rooms')
            return json.loads(rooms_data) if rooms_data else {}
        except:
            return {}
    return local_rooms

def set_rooms(rooms):
    if redis_client:
        try:
            redis_client.set('rooms', json.dumps(rooms))
        except:
            pass
    local_rooms.update(rooms)

def add_message_to_room(room_id, message):
    rooms = get_rooms()
    if room_id not in rooms:
        rooms[room_id] = {"clients": {}, "messages": []}
    rooms[room_id]["messages"].append(message)
    set_rooms(rooms)

def add_client_to_room(room_id, client_id, client_data):
    rooms = get_rooms()
    if room_id not in rooms:
        rooms[room_id] = {"clients": {}, "messages": []}
    rooms[room_id]["clients"][client_id] = client_data
    set_rooms(rooms)

@app.route("/command", methods=["POST"])
def receive_http_command():
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
            "last_seen": datetime.now().isoformat()
        }
        set_clients(clients)
        
        return jsonify({
            "command": command,
            "message": "Client registrato con successo!",
            "client_id": client_id,
            "status": "registered",
            "debug": debug_info
        })
    

    elif command.startswith("join_room:"):
        room_name = command.split(":", 1)[1]
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Client non registrato"}), 400
        

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
            "message": f"Entrato nella stanza '{room_name}'",
            "room_name": room_name,
            "clients_in_room": len(rooms.get(room_name, {}).get("clients", {})),
            "debug": debug_info
        })
    

    elif command.startswith("send_message:"):
        message_text = command.split(":", 1)[1]
        signature = data.get("signature")
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Client non registrato"}), 400
        
        room_id = clients[client_id]["room_id"]
        if not room_id:
            return jsonify({"error": "Non sei in nessuna stanza"}), 400
        

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
            "message": f"Messaggio inviato nella stanza '{room_id}'",
            "room_name": room_id,
            "message_text": message_text,
            "debug": debug_info
        })
    

    elif command == "get_messages":
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Client non registrato"}), 400
        
        room_id = clients[client_id]["room_id"]
        if not room_id:
            return jsonify({"error": "Non sei in nessuna stanza"}), 400
        
        rooms = get_rooms()
        messages = rooms.get(room_id, {}).get("messages", [])
        
        return jsonify({
            "command": command,
            "room_name": room_id,
            "messages": messages,
            "total_messages": len(messages),
            "debug": debug_info
        })
    

    elif command == "list_rooms":
        rooms = get_rooms()
        room_list = []
        for room_name, room_data in rooms.items():
            room_list.append({
                "name": room_name,
                "clients": len(room_data.get("clients", {})),
                "messages": len(room_data.get("messages", []))
            })
        
        return jsonify({
            "command": command,
            "message": "Lista stanze disponibili",
            "rooms": room_list,
            "debug": debug_info
        })
    

    elif command == "leave_room":
        clients = get_clients()
        
        if not client_id or client_id not in clients:
            return jsonify({"error": "Client non registrato"}), 400
        
        room_id = clients[client_id]["room_id"]
        if room_id:
            rooms = get_rooms()
            if room_id in rooms and client_id in rooms[room_id].get("clients", {}):
                del rooms[room_id]["clients"][client_id]
                set_rooms(rooms)
            
            clients[client_id]["room_id"] = None
            set_clients(clients)
            
            return jsonify({
                "command": command,
                "message": f"Uscito dalla stanza '{room_id}'",
                "debug": debug_info
            })
    

    return jsonify({
        "command": command, 
        "message": "Comando sconosciuto",
        "available_commands": [
            "upload_public_key",
            "join_room:NOME_STANZA",
            "send_message:TESTO", 
            "get_messages",
            "list_rooms",
            "leave_room"
        ],
        "debug": debug_info
    })

@app.route("/status", methods=["GET"])
def server_status():
    clients = get_clients()
    rooms = get_rooms()
    
    return jsonify({
        "server_instance": f"Flask-{id(app)}",
        "redis_available": redis_client is not None,
        "total_clients": len(clients),
        "total_rooms": len(rooms),
        "rooms": {name: {"clients": len(data.get("clients", {})), "messages": len(data.get("messages", []))} 
                 for name, data in rooms.items()}
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)