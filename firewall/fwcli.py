import json
import argparse

RULES_FILE = "rules.json"

def load_rules():
    try:
        with open(RULES_FILE, 'r') as f:
            return json.load(f)
    except:
        return {"blacklist": [], "whitelist": []}

def save_rules(rules):
    with open(RULES_FILE, 'w') as f:
        json.dump(rules, f, indent=4)

def block_ip(ip):
    rules = load_rules()
    if ip not in rules["blacklist"]:
        rules["blacklist"].append(ip)
    save_rules(rules)
    print(f"[+] Blocked {ip}")

def unblock_ip(ip):
    rules = load_rules()
    if ip in rules["blacklist"]:
        rules["blacklist"].remove(ip)
    save_rules(rules)
    print(f"[-] Unblocked {ip}")

def list_rules():
    rules = load_rules()
    print(json.dumps(rules, indent=4))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--block-ip")
    parser.add_argument("--unblock-ip")
    parser.add_argument("--list-rules", action="store_true")

    args = parser.parse_args()
    if args.block_ip:
        block_ip(args.block_ip)
    elif args.unblock_ip:
        unblock_ip(args.unblock_ip)
    elif args.list_rules:
        list_rules()
