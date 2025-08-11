
from flask import Flask, render_template, request, redirect, url_for, jsonify
import json
import os

app = Flask(__name__)

FIREWALL_RULES_PATH = "/app/logs/firewall/rules.json"
FIREWALL_LOG_PATH = "/app/logs/firewall/firewall.log"
HONEYPOT_LOG_PATH = "/app/logs/honeypot/log.txt"
FILE_RECEIVER_LOG_PATH = "/app/logs/file-receiver/log.txt"


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/firewall", methods=["GET", "POST"])
def firewall():
    if request.method == "POST":
        new_rules = request.form.get("rules")
        try:
            rules_data = json.loads(new_rules)
            with open(FIREWALL_RULES_PATH, "w") as f:
                json.dump(rules_data, f, indent=4)
        except PermissionError:
            return "Errore: impossibile modificare le regole (accesso read-only)", 403
        except Exception as e:
            return f"Errore aggiornamento regole: {e}", 400
        
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
    return render_template("stats.html", blocked_attempts=blocked_attempts)

@app.route("/health")
def health():

    return jsonify({"status": "healthy", "service": "dashboard"})

@app.route("/debug")
def debug():

    debug_info = {
        "current_directory": os.getcwd(),
        "firewall_rules_exists": os.path.exists(FIREWALL_RULES_PATH),
        "firewall_log_exists": os.path.exists(FIREWALL_LOG_PATH),
        "honeypot_log_exists": os.path.exists(HONEYPOT_LOG_PATH),
        "file_receiver_log_exists": os.path.exists(FILE_RECEIVER_LOG_PATH),
    }
    
    for path_name, path in [
        ("firewall_rules", FIREWALL_RULES_PATH),
        ("firewall_log", FIREWALL_LOG_PATH),
        ("honeypot_log", HONEYPOT_LOG_PATH),
        ("file_receiver_log", FILE_RECEIVER_LOG_PATH)
    ]:
        debug_info[f"{path_name}_readable"] = os.access(path, os.R_OK) if os.path.exists(path) else False
        debug_info[f"{path_name}_size"] = os.path.getsize(path) if os.path.exists(path) else 0
    
    return jsonify(debug_info)

def read_file(path):

    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
                return content if content.strip() else "File vuoto"
        else:
            return f"File non trovato: {path}"
    except PermissionError:
        return f"Permessi insufficienti per leggere: {path}"
    except UnicodeDecodeError:
        try:
            with open(path, "r", encoding="latin-1") as f:
                return f.read()
        except Exception as e:
            return f"Errore di encoding per {path}: {str(e)}"
    except Exception as e:
        return f"Errore lettura file {path}: {str(e)}"

if __name__ == "__main__":
    print(f"Dashboard starting...")
    print(f"Firewall rules path: {FIREWALL_RULES_PATH}")
    print(f"Firewall log path: {FIREWALL_LOG_PATH}")
    print(f"Honeypot log path: {HONEYPOT_LOG_PATH}")
    print(f"File receiver log path: {FILE_RECEIVER_LOG_PATH}")
    
    app.run(host="0.0.0.0", port=8000, debug=True)