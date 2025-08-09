from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/command", methods=["POST"])
def receive_http_command():
    data = request.get_json()
    if not data or "command" not in data:
        return jsonify({"error": "Missing 'command' in JSON"}), 400

    command = data["command"]
    print(f"[HTTP] Comando ricevuto: {command}")

    # Risposta fissa
    return jsonify({"message": "Messaggio ricevuto!"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
