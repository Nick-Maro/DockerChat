from flask import Flask, render_template, request, redirect, url_for, jsonify, flash
import json
import os
import redis

app = Flask(__name__)
app.secret_key = 'your-secret-key-here'

FIREWALL_RULES_PATH = "/app/logs/firewall/rules.json"
FIREWALL_LOG_PATH = "/app/logs/firewall/firewall.log"
HONEYPOT_LOG_PATH = "/app/logs/honeypot/log.txt"
FILE_RECEIVER_LOG_PATH = "/app/logs/file-receiver/log.txt"

try:
    redis_client = redis.Redis(host='redis', port=6379, db=0, decode_responses=True)
    redis_client.ping()
    REDIS_AVAILABLE = True
    print("Connected to Redis")
except:
    print("Redis not available")
    redis_client = None
    REDIS_AVAILABLE = False

@app.route("/")
def index():
    return render_template("index.html", redis_available=REDIS_AVAILABLE)

@app.route("/firewall", methods=["GET", "POST"])
def firewall():
    if request.method == "POST":
        new_rules = request.form.get("rules")
        try:
            rules_data = json.loads(new_rules)
            with open(FIREWALL_RULES_PATH, "w") as f:
                json.dump(rules_data, f, indent=4)
            flash("Firewall rules updated successfully", "success")
        except PermissionError:
            flash("Error: cannot modify rules (read-only access)", "error")
            return render_template("firewall.html", rules=new_rules, error=True), 403
        except Exception as e:
            flash(f"Error updating rules: {e}", "error")
            return render_template("firewall.html", rules=new_rules, error=True), 400
                
        return redirect(url_for("firewall"))
        
    if os.path.exists(FIREWALL_RULES_PATH):
        with open(FIREWALL_RULES_PATH, "r") as f:
            rules = json.load(f)
    else:
        rules = {}
        
    return render_template("firewall.html", rules=json.dumps(rules, indent=4))

@app.route("/logs")
def logs():
    firewall_log = read_file(FIREWALL_LOG_PATH)
    honeypot_log = read_file(HONEYPOT_LOG_PATH)
    receiver_log = read_file(FILE_RECEIVER_LOG_PATH)
    return render_template("logs.html",
                          firewall_log=firewall_log,
                          honeypot_log=honeypot_log,
                          receiver_log=receiver_log)

@app.route("/stats")
def stats():
    firewall_log = read_file(FIREWALL_LOG_PATH)
    blocked_attempts = sum(1 for line in firewall_log.splitlines() if "BLOCKED" in line)
    
    redis_stats = {}
    if REDIS_AVAILABLE:
        try:
            redis_stats = get_redis_stats()
        except Exception as e:
            redis_stats = {"error": str(e)}
    
    return render_template("stats.html", 
                          blocked_attempts=blocked_attempts,
                          redis_stats=redis_stats,
                          redis_available=REDIS_AVAILABLE)

@app.route("/redis")
def redis_management():
    print(f"Redis available: {REDIS_AVAILABLE}")
    if not REDIS_AVAILABLE:
        print("Redis not available, redirecting to index")
        flash("Redis is not available", "error")
        return redirect(url_for("index"))
    
    try:
        print("Getting Redis data...")
        redis_data = get_redis_data()
        print(f"Redis data: {redis_data}")
        redis_stats = get_redis_stats()
        print(f"Redis stats: {redis_stats}")
        return render_template("redis.html", 
                              redis_data=redis_data,
                              redis_stats=redis_stats)
    except Exception as e:
        print(f"Exception in redis route: {e}")
        flash(f"Error accessing Redis: {e}", "error")
        return redirect(url_for("index"))

@app.route("/redis/clear", methods=["POST"])
def clear_redis():
    if not REDIS_AVAILABLE:
        return jsonify({"success": False, "message": "Redis not available"}), 503
    
    clear_type = request.form.get("clear_type", "all")
    
    try:
        if clear_type == "all":
            redis_client.flushdb()
            message = "All Redis data cleared successfully"
        elif clear_type == "clients":
            redis_client.delete('clients')
            message = "Client data cleared successfully"
        elif clear_type == "rooms":
            redis_client.delete('rooms')
            message = "Room data cleared successfully"
        elif clear_type == "private_messages":
            redis_client.delete('private_messages')
            message = "Private messages cleared successfully"
        else:
            return jsonify({"success": False, "message": "Invalid clear type"}), 400
        
        flash(message, "success")
        return jsonify({"success": True, "message": message})
    except Exception as e:
        error_msg = f"Error clearing Redis: {e}"
        flash(error_msg, "error")
        return jsonify({"success": False, "message": error_msg}), 500

@app.route("/redis/export")
def export_redis():
    if not REDIS_AVAILABLE:
        return jsonify({"error": "Redis not available"}), 503
    
    try:
        data = get_redis_data()
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/health")
def health():
    health_status = {
        "status": "healthy",
        "service": "dashboard",
        "redis_available": REDIS_AVAILABLE
    }
    
    if REDIS_AVAILABLE:
        try:
            redis_client.ping()
            health_status["redis_status"] = "connected"
        except:
            health_status["redis_status"] = "disconnected"
            health_status["status"] = "degraded"
    
    return jsonify(health_status)

@app.route("/debug")
def debug():
    debug_info = {
        "current_directory": os.getcwd(),
        "firewall_rules_exists": os.path.exists(FIREWALL_RULES_PATH),
        "firewall_log_exists": os.path.exists(FIREWALL_LOG_PATH),
        "honeypot_log_exists": os.path.exists(HONEYPOT_LOG_PATH),
        "file_receiver_log_exists": os.path.exists(FILE_RECEIVER_LOG_PATH),
        "redis_available": REDIS_AVAILABLE,
    }
    
    for path_name, path in [
        ("firewall_rules", FIREWALL_RULES_PATH),
        ("firewall_log", FIREWALL_LOG_PATH),
        ("honeypot_log", HONEYPOT_LOG_PATH),
        ("file_receiver_log", FILE_RECEIVER_LOG_PATH)
    ]:
        debug_info[f"{path_name}_readable"] = os.access(path, os.R_OK) if os.path.exists(path) else False
        debug_info[f"{path_name}_size"] = os.path.getsize(path) if os.path.exists(path) else 0
    
    if REDIS_AVAILABLE:
        try:
            debug_info["redis_info"] = get_redis_stats()
        except Exception as e:
            debug_info["redis_error"] = str(e)
    
    return jsonify(debug_info)

def get_redis_data():
    if not REDIS_AVAILABLE:
        return {}
    
    data = {}
    
    try:
        clients_data = redis_client.get('clients')
        data['clients'] = json.loads(clients_data) if clients_data else {}
    except:
        data['clients'] = {}
    
    try:
        rooms_data = redis_client.get('rooms')
        data['rooms'] = json.loads(rooms_data) if rooms_data else {}
    except:
        data['rooms'] = {}
    
    try:
        private_data = redis_client.get('private_messages')
        data['private_messages'] = json.loads(private_data) if private_data else {}
    except:
        data['private_messages'] = {}
    
    return data

def get_redis_stats():
    if not REDIS_AVAILABLE:
        return {}
    
    data = get_redis_data()
    
    total_clients = len(data.get('clients', {}))
    total_rooms = len(data.get('rooms', {}))
    total_private_messages = len(data.get('private_messages', {}))
    
    total_room_messages = 0
    active_rooms = 0
    for room_data in data.get('rooms', {}).values():
        messages = room_data.get('messages', [])
        total_room_messages += len(messages)
        if room_data.get('clients', {}):
            active_rooms += 1
    
    online_clients = 0
    for client_data in data.get('clients', {}).values():
        if client_data.get('last_seen'):
            from datetime import datetime, timedelta
            try:
                last_seen = datetime.fromisoformat(client_data['last_seen'])
                if datetime.now() - last_seen <= timedelta(hours=1):
                    online_clients += 1
            except:
                pass
    
    return {
        "total_clients": total_clients,
        "online_clients": online_clients,
        "total_rooms": total_rooms,
        "active_rooms": active_rooms,
        "total_room_messages": total_room_messages,
        "total_private_messages": total_private_messages,
        "database_keys": redis_client.dbsize() if REDIS_AVAILABLE else 0
    }

def read_file(path):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
                return content if content.strip() else "Empty file"
        else:
            return f"File not found: {path}"
    except PermissionError:
        return f"Insufficient permissions to read: {path}"
    except UnicodeDecodeError:
        try:
            with open(path, "r", encoding="latin-1") as f:
                return f.read()
        except Exception as e:
            return f"Encoding error for {path}: {str(e)}"
    except Exception as e:
        return f"File read error {path}: {str(e)}"

if __name__ == "__main__":
    print(f"Dashboard starting...")
    print(f"Firewall rules path: {FIREWALL_RULES_PATH}")
    print(f"Firewall log path: {FIREWALL_LOG_PATH}")
    print(f"Honeypot log path: {HONEYPOT_LOG_PATH}")
    print(f"File receiver log path: {FILE_RECEIVER_LOG_PATH}")
    print(f"Redis available: {REDIS_AVAILABLE}")
    
    app.run(host="0.0.0.0", port=8000, debug=True)