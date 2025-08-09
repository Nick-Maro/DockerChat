from flask import Flask, request
import socket

app = Flask(__name__)

@app.route("/")
def index():
    hostname = socket.gethostname()
    client_ip = request.remote_addr
    return {
        "message": "Hello from backend server!",
        "server_hostname": hostname,
        "client_ip": client_ip
    }

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
