from datetime import datetime

LOG_FILENAME = "firewall.log"

def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILENAME, "a") as f:
        f.write(f"[{timestamp}] {message}\n")
