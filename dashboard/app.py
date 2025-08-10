from flask import Flask, render_template, request, redirect, url_for, jsonify
import json
import os

app = Flask(__name__)

FIREWALL_RULES_PATH = "../firewall/rules.json"
FIREWALL_LOG_PATH = "../firewall/firewall.log"
HONEYPOT_LOG_PATH = "../honeypot/log.txt"
FILE_RECEIVER_LOG_PATH = "../file-receiver/log.txt"

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

def read_file(path):
    if os.path.exists(path):
        with open(path, "r") as f:
            return f.read()
    return "Nessun dato disponibile."

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
