package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strconv"
	"sync"
	"time"
)

const (
	BufferSize          = 4096
	RulesReloadInterval = 1 * time.Second
	CleanupInterval     = 5 * time.Minute
	DefaultFirewallPort = 5001
	DefaultProxyPort    = 8080
)

type Rules struct {
	BlockedIPs           []string `json:"blocked_ips"`
	Whitelist            []string `json:"whitelist"`
	AllowedPorts         []int    `json:"allowed_ports"`
	MaxAttemptsPerMinute int      `json:"max_attempts_per_minute"`
}

type Firewall struct {
	rules              *Rules
	rulesMutex         sync.RWMutex
	rulesFile          string
	rulesModTime       time.Time
	connectionAttempts map[string][]time.Time
	attemptsMutex      sync.RWMutex

	firewallPort int
	proxyHost    string
	proxyPort    int
}

func NewFirewall() *Firewall {
	fw := &Firewall{
		rulesFile:          "rules.json",
		connectionAttempts: make(map[string][]time.Time),
		firewallPort:       getEnvInt("FIREWALL_PORT", DefaultFirewallPort),
		proxyHost:          getEnv("REVERSE_PROXY_IP", "reverse-proxy"),
		proxyPort:          getEnvInt("REVERSE_PROXY_PORT", DefaultProxyPort),
	}
	fw.loadRules()
	return fw
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func (fw *Firewall) defaultRules() *Rules {
	return &Rules{
		BlockedIPs:           []string{},
		Whitelist:            []string{},
		AllowedPorts:         []int{80, 443},
		MaxAttemptsPerMinute: 5,
	}
}

func (fw *Firewall) loadRules() {
	stat, err := os.Stat(fw.rulesFile)
	if err != nil {
		fw.rulesMutex.Lock()
		if fw.rules == nil {
			fw.rules = fw.defaultRules()
			log.Printf("[RULES] Using default rules (file not found)")
		}
		fw.rulesMutex.Unlock()
		return
	}

	if fw.rules != nil && stat.ModTime().Equal(fw.rulesModTime) {
		return
	}

	data, err := os.ReadFile(fw.rulesFile)
	if err != nil {
		log.Printf("[ERROR] Failed to read rules file: %v", err)
		return
	}

	var tempRules Rules
	if err := json.Unmarshal(data, &tempRules); err != nil {
		log.Printf("[ERROR] Failed to parse rules JSON: %v", err)
		return
	}

	if tempRules.MaxAttemptsPerMinute <= 0 {
		tempRules.MaxAttemptsPerMinute = 5
	}
	if len(tempRules.AllowedPorts) == 0 {
		tempRules.AllowedPorts = []int{80, 443}
	}

	fw.rulesMutex.Lock()
	fw.rules = &tempRules
	fw.rulesModTime = stat.ModTime()
	fw.rulesMutex.Unlock()

	log.Printf("[RULES] Loaded rules: blocked_ips=%d, whitelist=%d, allowed_ports=%v, max_attempts=%d",
		len(tempRules.BlockedIPs), len(tempRules.Whitelist), tempRules.AllowedPorts, tempRules.MaxAttemptsPerMinute)
}

func (fw *Firewall) rulesWatcher() {
	ticker := time.NewTicker(RulesReloadInterval)
	defer ticker.Stop()

	for range ticker.C {
		fw.loadRules()
	}
}

func (fw *Firewall) isWhitelisted(ip string) bool {
	fw.rulesMutex.RLock()
	defer fw.rulesMutex.RUnlock()

	for _, whiteIP := range fw.rules.Whitelist {
		if ip == whiteIP {
			return true
		}
	}
	return false
}

func (fw *Firewall) isBlocked(ip string) bool {
	fw.rulesMutex.RLock()
	defer fw.rulesMutex.RUnlock()

	for _, blockedIP := range fw.rules.BlockedIPs {
		if ip == blockedIP {
			return true
		}
	}
	return false
}

func (fw *Firewall) isAllowedPort(port int) bool {
	fw.rulesMutex.RLock()
	defer fw.rulesMutex.RUnlock()

	if len(fw.rules.AllowedPorts) == 0 {
		return true
	}

	for _, allowedPort := range fw.rules.AllowedPorts {
		if port == allowedPort {
			return true
		}
	}
	return false
}

func (fw *Firewall) isRateLimited(ip string) bool {
	now := time.Now()
	window := time.Minute

	fw.attemptsMutex.Lock()
	defer fw.attemptsMutex.Unlock()

	attempts := fw.connectionAttempts[ip]

	var validAttempts []time.Time
	for _, attempt := range attempts {
		if now.Sub(attempt) < window {
			validAttempts = append(validAttempts, attempt)
		}
	}

	validAttempts = append(validAttempts, now)
	fw.connectionAttempts[ip] = validAttempts

	fw.rulesMutex.RLock()
	maxAttempts := fw.rules.MaxAttemptsPerMinute
	fw.rulesMutex.RUnlock()

	return len(validAttempts) > maxAttempts
}

func (fw *Firewall) cleanupOldAttempts() {
	now := time.Now()
	window := time.Minute

	fw.attemptsMutex.Lock()
	defer fw.attemptsMutex.Unlock()

	for ip, attempts := range fw.connectionAttempts {
		var validAttempts []time.Time
		for _, attempt := range attempts {
			if now.Sub(attempt) < window {
				validAttempts = append(validAttempts, attempt)
			}
		}

		if len(validAttempts) == 0 {
			delete(fw.connectionAttempts, ip)
		} else {
			fw.connectionAttempts[ip] = validAttempts
		}
	}
}

func (fw *Firewall) attemptsCleanupWatcher() {
	ticker := time.NewTicker(CleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		fw.cleanupOldAttempts()
	}
}

func (fw *Firewall) forwardData(src, dst net.Conn, wg *sync.WaitGroup) {
	defer wg.Done()

	_, err := io.Copy(dst, src)
	if err != nil {
		log.Printf("[DEBUG] Forward error: %v", err)
	}

	if tcpConn, ok := dst.(*net.TCPConn); ok {
		tcpConn.CloseWrite()
	}
}

func (fw *Firewall) handleConnection(conn net.Conn) {
	defer conn.Close()

	clientAddr := conn.RemoteAddr().(*net.TCPAddr)
	ip := clientAddr.IP.String()

	log.Printf("[DEBUG] Incoming connection from %s:%d", ip, clientAddr.Port)

	if fw.isWhitelisted(ip) {
		log.Printf("[WHITELIST] %s allowed by whitelist", ip)
	} else {
		if fw.isBlocked(ip) {
			log.Printf("[BLOCKED] Connection from %s blocked by config", ip)
			return
		}

		if !fw.isAllowedPort(fw.proxyPort) {
			log.Printf("[BLOCKED] Destination port %d not allowed by rules. Rejecting %s", fw.proxyPort, ip)
			return
		}

		if fw.isRateLimited(ip) {
			fw.rulesMutex.RLock()
			maxAttempts := fw.rules.MaxAttemptsPerMinute
			fw.rulesMutex.RUnlock()
			log.Printf("[BLOCKED - RATE LIMIT] %s exceeded %d attempts/min", ip, maxAttempts)
			return
		}
	}

	log.Printf("[ALLOWED] Connection from %s -> proxying to %s:%d", ip, fw.proxyHost, fw.proxyPort)

	proxyAddr := net.JoinHostPort(fw.proxyHost, strconv.Itoa(fw.proxyPort))
	proxyConn, err := net.DialTimeout("tcp", proxyAddr, 5*time.Second)
	if err != nil {
		log.Printf("[ERROR] Cannot connect to reverse proxy %s - %v", proxyAddr, err)
		return
	}
	defer proxyConn.Close()

	var wg sync.WaitGroup
	wg.Add(2)

	go fw.forwardData(conn, proxyConn, &wg)
	go fw.forwardData(proxyConn, conn, &wg)

	wg.Wait()
	log.Printf("[CLOSED] Connection %s", ip)
}

func (fw *Firewall) Start() error {
	go fw.rulesWatcher()
	go fw.attemptsCleanupWatcher()

	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", fw.firewallPort))
	if err != nil {
		return fmt.Errorf("failed to listen on port %d: %v", fw.firewallPort, err)
	}
	defer listener.Close()

	log.Printf("[FIREWALL] Listening on 0.0.0.0:%d -> proxy %s:%d",
		fw.firewallPort, fw.proxyHost, fw.proxyPort)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("[ERROR] Accept failed: %v", err)
			continue
		}

		go fw.handleConnection(conn)
	}
}

func main() {
	firewall := NewFirewall()

	if err := firewall.Start(); err != nil {
		log.Fatalf("[FIREWALL] Failed to start: %v", err)
	}
}
