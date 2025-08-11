#!/usr/bin/env python3

import json
import socket
import threading
import os
import time
from dotenv import load_dotenv

load_dotenv()


HERE = os.path.dirname(os.path.abspath(__file__))
RULES_FILE = os.path.join(HERE, "rules.json")
FIREWALL_PORT = int(os.getenv("FIREWALL_PORT", 5001))
REVERSE_PROXY_IP = os.getenv("REVERSE_PROXY_IP", "reverse-proxy")
REVERSE_PROXY_PORT = int(os.getenv("REVERSE_PROXY_PORT", 8080))

BUFFER_SIZE = 4096
RULES_RELOAD_INTERVAL = 1.0  


_rules_lock = threading.Lock()
_rules = None
_rules_mtime = 0.0

_attempts_lock = threading.Lock()
_connection_attempts = {} 


try:
    import logger as external_logger
    def log(msg):
        try:
            external_logger.log(msg)
        except Exception:
            print(msg)
except Exception:
    def log(msg):
        print(msg)

def _default_rules():
    return {
        "blocked_ips": [],
        "whitelist": [],
        "allowed_ports": [80, 443],
        "max_attempts_per_minute": 5
    }

def load_rules_from_file():
    
    try:
        with open(RULES_FILE, "r") as f:
            data = json.load(f)
    except Exception:
        data = _default_rules()

   
    normalized = _default_rules()
    if isinstance(data, dict):
        
        if "blocked_ips" in data:
            normalized["blocked_ips"] = list(data.get("blocked_ips") or [])
        elif "blacklist" in data:
            normalized["blocked_ips"] = list(data.get("blacklist") or [])

       
        if "whitelist" in data:
            normalized["whitelist"] = list(data.get("whitelist") or [])

        
        if "allowed_ports" in data:
            try:
                normalized["allowed_ports"] = [int(p) for p in data.get("allowed_ports") or []]
            except Exception:
                normalized["allowed_ports"] = normalized["allowed_ports"]

        
        if "max_attempts_per_minute" in data:
            try:
                v = int(data.get("max_attempts_per_minute"))
                if v > 0:
                    normalized["max_attempts_per_minute"] = v
            except Exception:
                pass

    return normalized

def reload_rules_if_changed():
    
    global _rules, _rules_mtime
    try:
        mtime = os.path.getmtime(RULES_FILE)
    except Exception:
        mtime = 0.0

    if _rules is None or mtime != _rules_mtime:
        try:
            new_rules = load_rules_from_file()
            with _rules_lock:
                _rules = new_rules
                _rules_mtime = mtime
            log(f"[RULES] Loaded rules (mtime={mtime}): {new_rules}")
        except Exception as e:
            log(f"[ERROR] Reloading rules failed: {e}")

def rules_watcher():
   
    while True:
        try:
            reload_rules_if_changed()
        except Exception:
            pass
        time.sleep(RULES_RELOAD_INTERVAL)

def get_rules():
    
    if _rules is None:
        reload_rules_if_changed()
    with _rules_lock:
        return _rules.copy() if isinstance(_rules, dict) else _default_rules()

def is_whitelisted(ip, rules):
    return ip in rules.get("whitelist", [])

def is_blocked(ip, rules):
    return ip in rules.get("blocked_ips", [])

def is_allowed_port(port, rules):
    allowed = rules.get("allowed_ports", [])
    
    if not allowed:
        return True
    return int(port) in allowed

def is_rate_limited(ip, rules):
    
    window = 60.0
    now = time.time()
    max_attempts = int(rules.get("max_attempts_per_minute", 5))

    with _attempts_lock:
        timestamps = _connection_attempts.get(ip, [])
        
        timestamps = [t for t in timestamps if now - t < window]
        timestamps.append(now)
        _connection_attempts[ip] = timestamps
        return len(timestamps) > max_attempts

def forward_data(src, dst):
  
    try:
        while True:
            data = src.recv(BUFFER_SIZE)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        try:
            src.shutdown(socket.SHUT_RD)
        except Exception:
            pass
        try:
            dst.shutdown(socket.SHUT_WR)
        except Exception:
            pass

def handle_client(client_sock, client_addr):
    
    ip = client_addr[0]
    rules = get_rules()  
    log(f"[DEBUG] Incoming connection from {ip}:{client_addr[1]}")


    if is_whitelisted(ip, rules):
        log(f"[WHITELIST] {ip} allowed by whitelist.")


    if is_blocked(ip, rules):
        log(f"[BLOCKED] Connection from {ip} blocked by config.")
        try:
            client_sock.close()
        except Exception:
            pass
        return


    if not is_allowed_port(REVERSE_PROXY_PORT, rules):
        log(f"[BLOCKED] Destination port {REVERSE_PROXY_PORT} not allowed by rules. Rejecting {ip}.")
        try:
            client_sock.close()
        except Exception:
            pass
        return


    if is_rate_limited(ip, rules):
        log(f"[BLOCKED - RATE LIMIT] {ip} exceeded {rules.get('max_attempts_per_minute')} attempts/min.")
        try:
            client_sock.close()
        except Exception:
            pass
        return


    log(f"[ALLOWED] Connection from {ip} -> proxying to {REVERSE_PROXY_IP}:{REVERSE_PROXY_PORT}")

    try:
        proxy_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        proxy_sock.settimeout(5.0)
        proxy_sock.connect((REVERSE_PROXY_IP, REVERSE_PROXY_PORT))
        proxy_sock.settimeout(None)
    except Exception as e:
        log(f"[ERROR] Cannot connect to reverse proxy {REVERSE_PROXY_IP}:{REVERSE_PROXY_PORT} - {e}")
        try:
            client_sock.close()
        except Exception:
            pass
        return


    t1 = threading.Thread(target=forward_data, args=(client_sock, proxy_sock), daemon=True)
    t2 = threading.Thread(target=forward_data, args=(proxy_sock, client_sock), daemon=True)
    t1.start()
    t2.start()


    t1.join()
    t2.join()
    try:
        client_sock.close()
    except Exception:
        pass
    try:
        proxy_sock.close()
    except Exception:
        pass
    log(f"[CLOSED] Connection {ip}")

def main():

    watcher = threading.Thread(target=rules_watcher, daemon=True)
    watcher.start()


    reload_rules_if_changed()

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", FIREWALL_PORT))
    sock.listen(128)
    log(f"[FIREWALL] Listening on 0.0.0.0:{FIREWALL_PORT} -> proxy {REVERSE_PROXY_IP}:{REVERSE_PROXY_PORT}")

    try:
        while True:
            try:
                conn, addr = sock.accept()
            except KeyboardInterrupt:
                log("[FIREWALL] Shutting down by KeyboardInterrupt")
                break
            except Exception as e:
                log(f"[ERROR] Accept failed: {e}")
                continue


            th = threading.Thread(target=handle_client, args=(conn, addr), daemon=True)
            th.start()

    finally:
        try:
            sock.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()
