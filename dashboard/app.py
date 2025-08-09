from flask import Flask, render_template, jsonify

app = Flask(__name__)


firewall_status = {
    "active": True,
    "rules": ["Allow 192.168.1.0/24", "Block 10.0.0.5"],
    "blocked_ips": ["10.0.0.5", "192.168.2.100"],
    "logs": [
        "2025-08-08 14:00:00 - Bloccato IP 10.0.0.5",
        "2025-08-08 14:05:00 - Permesso IP 192.168.1.10"
    ]
}

@app.route("/")
def index():
    return render_template("index.html", status=firewall_status)

@app.route("/api/status")
def api_status():
    return jsonify(firewall_status)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
