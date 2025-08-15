import json
from json import JSONDecodeError
import argparse

RULES_FILE = "rules.json"

def load_rules():
    try:
        with open(RULES_FILE, 'r') as f:
            return json.load(f)
    except JSONDecodeError:
        return {
            "blocked_ips": [],
            "allowed_ports": [80, 443],
            "max_attempts_per_minute": 250
        }

def save_rules(rules):
    with open(RULES_FILE, 'w') as f:
        json.dump(rules, f, indent=4)

def block_ip(ip):
    rules = load_rules()
    if ip not in rules["blocked_ips"]:
        rules["blocked_ips"].append(ip)
        save_rules(rules)
        print(f"[+] Blocked IP: {ip}")
    else:
        print(f"IP {ip} is already blocked.")

def unblock_ip(ip):
    rules = load_rules()
    if ip in rules["blocked_ips"]:
        rules["blocked_ips"].remove(ip)
        save_rules(rules)
        print(f"[-] Unblocked IP: {ip}")
    else:
        print(f"IP {ip} is not in blocked list.")

def add_port(port):
    rules = load_rules()
    port = int(port)
    if port not in rules["allowed_ports"]:
        rules["allowed_ports"].append(port)
        rules["allowed_ports"].sort()
        save_rules(rules)
        print(f"[+] Added allowed port: {port}")
    else:
        print(f"Port {port} is already allowed.")

def remove_port(port):
    rules = load_rules()
    port = int(port)
    if port in rules["allowed_ports"]:
        rules["allowed_ports"].remove(port)
        save_rules(rules)
        print(f"[-] Removed allowed port: {port}")
    else:
        print(f"Port {port} is not in allowed ports.")

def set_max_attempts(value):
    rules = load_rules()
    try:
        val = int(value)
        if val <= 0:
            print("max_attempts_per_minute must be > 0")
            return
        rules["max_attempts_per_minute"] = val
        save_rules(rules)
        print(f"[+] Set max_attempts_per_minute to {val}")
    except ValueError:
        print("Invalid value for max_attempts_per_minute")

def list_rules():
    rules = load_rules()
    print(json.dumps(rules, indent=4))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Firewall CLI tool")
    parser.add_argument("--block-ip", help="Add IP to blocked_ips")
    parser.add_argument("--unblock-ip", help="Remove IP from blocked_ips")
    parser.add_argument("--add-port", help="Add port to allowed_ports")
    parser.add_argument("--remove-port", help="Remove port from allowed_ports")
    parser.add_argument("--set-max-attempts", help="Set max_attempts_per_minute")
    parser.add_argument("--list-rules", action="store_true", help="List all firewall rules")

    args = parser.parse_args()

    if args.block_ip:
        block_ip(args.block_ip)
    elif args.unblock_ip:
        unblock_ip(args.unblock_ip)
    elif args.add_port:
        add_port(args.add_port)
    elif args.remove_port:
        remove_port(args.remove_port)
    elif args.set_max_attempts:
        set_max_attempts(args.set_max_attempts)
    elif args.list_rules:
        list_rules()
    else:
        parser.print_help()
