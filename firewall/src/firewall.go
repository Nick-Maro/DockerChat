package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	BufferSize            = 4096
	RulesReloadInterval   = 1 * time.Second
	CleanupInterval       = 5 * time.Minute
	DefaultFirewallPort   = 5001
	DefaultProxyPort      = 8080
	MaxTrackedIPs         = 10000
	ForceCleanupThreshold = 8000
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
	logger             *FirewallLogger

	firewallPort int
	proxyHost    string
	proxyPort    int
}

func NewFirewall() *Firewall {
	fw := &Firewall{
		rulesFile:          "/var/log/shared/firewall/rules.json",
		connectionAttempts: make(map[string][]time.Time),
		firewallPort:       getEnvInt("FIREWALL_PORT", DefaultFirewallPort),
		proxyHost:          getEnv("REVERSE_PROXY_IP", "reverse-proxy"),
		proxyPort:          getEnvInt("REVERSE_PROXY_PORT", DefaultProxyPort),
	}

	logger, err := NewFirewallLogger()
	if err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}
	fw.logger = logger

	fw.loadRules()
	fw.logger.LogStartup("Firewall initialized - Port: %d, Proxy: %s:%d", fw.firewallPort, fw.proxyHost, fw.proxyPort)
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
	os.MkdirAll(filepath.Dir(fw.rulesFile), 0755)

	stat, err := os.Stat(fw.rulesFile)
	if err != nil {
		fw.rulesMutex.Lock()
		if fw.rules == nil {
			fw.rules = fw.defaultRules()
			if fw.logger != nil {
				fw.logger.LogWarning("RULES", "Using default rules (file not found), creating: %s", fw.rulesFile)
			}
			fw.saveRulesToFile(fw.rules)
		}
		fw.rulesMutex.Unlock()
		return
	}

	fw.rulesMutex.RLock()
	currentModTime := fw.rulesModTime
	fw.rulesMutex.RUnlock()

	if fw.rules != nil && stat.ModTime().Equal(currentModTime) {
		return
	}

	data, err := os.ReadFile(fw.rulesFile)
	if err != nil {
		if fw.logger != nil {
			fw.logger.LogError("RULES", "Failed to read rules file: %v", err)
		}
		return
	}

	var tempRules Rules
	if err := json.Unmarshal(data, &tempRules); err != nil {
		if fw.logger != nil {
			fw.logger.LogError("RULES", "Failed to parse rules JSON: %v - keeping current rules", err)
		}
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

	if fw.logger != nil {
		fw.logger.LogRulesReload(len(tempRules.BlockedIPs), len(tempRules.Whitelist), tempRules.AllowedPorts, tempRules.MaxAttemptsPerMinute)
	}
}

func (fw *Firewall) saveRulesToFile(rules *Rules) error {
	data, err := json.MarshalIndent(rules, "", "  ")
	if err != nil {
		if fw.logger != nil {
			fw.logger.LogError("RULES", "Failed to marshal rules: %v", err)
		}
		return err
	}

	err = os.WriteFile(fw.rulesFile, data, 0644)
	if err != nil {
		if fw.logger != nil {
			fw.logger.LogError("RULES", "Failed to write rules file: %v", err)
		}
		return err
	}

	if fw.logger != nil {
		fw.logger.LogDebug("RULES", "Rules saved to: %s", fw.rulesFile)
	}
	return nil
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

	if len(fw.connectionAttempts) >= MaxTrackedIPs {
		for oldIP := range fw.connectionAttempts {
			delete(fw.connectionAttempts, oldIP)
			if fw.logger != nil {
				fw.logger.LogWarning("RATELIMIT", "Dropped tracking for IP %s due to memory limits", oldIP)
			}
			break
		}
	}

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
	deletedEntries := 0

	fw.attemptsMutex.Lock()
	defer fw.attemptsMutex.Unlock()

	forceCleanup := len(fw.connectionAttempts) > ForceCleanupThreshold

	for ip, attempts := range fw.connectionAttempts {
		var validAttempts []time.Time

		cleanupWindow := window
		if forceCleanup {
			cleanupWindow = 30 * time.Second
		}

		for _, attempt := range attempts {
			if now.Sub(attempt) < cleanupWindow {
				validAttempts = append(validAttempts, attempt)
			}
		}

		if len(validAttempts) == 0 {
			delete(fw.connectionAttempts, ip)
			deletedEntries++
		} else {
			fw.connectionAttempts[ip] = validAttempts
		}
	}

	if len(fw.connectionAttempts) > MaxTrackedIPs {
		excess := len(fw.connectionAttempts) - MaxTrackedIPs
		count := 0
		for ip := range fw.connectionAttempts {
			if count >= excess {
				break
			}
			delete(fw.connectionAttempts, ip)
			deletedEntries++
			count++
		}

		if fw.logger != nil {
			fw.logger.LogWarning("RATELIMIT", "Force cleanup: removed %d excess IP entries", excess)
		}
	}

	if fw.logger != nil && deletedEntries > 0 {
		fw.logger.LogCleanup(deletedEntries)
	}

	if len(fw.connectionAttempts) > ForceCleanupThreshold && fw.logger != nil {
		fw.logger.LogWarning("RATELIMIT", "High IP tracking usage: %d/%d IPs", len(fw.connectionAttempts), MaxTrackedIPs)
	}
}

func (fw *Firewall) attemptsCleanupWatcher() {
	ticker := time.NewTicker(CleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		fw.cleanupOldAttempts()
	}
}

func (fw *Firewall) forwardData(src, dst net.Conn, direction string, wg *sync.WaitGroup) {
	defer wg.Done()

	src.SetReadDeadline(time.Now().Add(30 * time.Second))
	dst.SetWriteDeadline(time.Now().Add(30 * time.Second))

	written, err := io.Copy(dst, src)
	if err != nil {
		if fw.logger != nil && !isConnectionClosed(err) {
			fw.logger.LogDebug("PROXY", "Forward error (%s): %v", direction, err)
		}
	}

	if tcpConn, ok := dst.(*net.TCPConn); ok {
		tcpConn.CloseWrite()
	}

	if fw.logger != nil && written > 0 {
		fw.logger.LogDebug("PROXY", "Forwarded %d bytes (%s)", written, direction)
	}
}

func isConnectionClosed(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "use of closed network connection") ||
		strings.Contains(errStr, "connection reset by peer") ||
		strings.Contains(errStr, "broken pipe")
}

func (fw *Firewall) handleConnection(conn net.Conn) {
	defer conn.Close()

	clientAddr := conn.RemoteAddr().(*net.TCPAddr)
	ip := clientAddr.IP.String()

	fw.logger.LogConnection(ip, clientAddr.Port, "INCOMING")

	if fw.isWhitelisted(ip) {
		fw.logger.LogWhitelist(ip)
	} else {
		if fw.isBlocked(ip) {
			fw.logger.LogBlocked(ip, "blocked by configuration")
			return
		}

		if !fw.isAllowedPort(fw.proxyPort) {
			fw.logger.LogBlocked(ip, "destination port not allowed", fw.proxyPort)
			return
		}

		if fw.isRateLimited(ip) {
			fw.rulesMutex.RLock()
			maxAttempts := fw.rules.MaxAttemptsPerMinute
			fw.rulesMutex.RUnlock()

			fw.attemptsMutex.RLock()
			currentAttempts := len(fw.connectionAttempts[ip])
			fw.attemptsMutex.RUnlock()

			fw.logger.LogRateLimit(ip, currentAttempts, maxAttempts)
			return
		}
	}

	proxyAddr := net.JoinHostPort(fw.proxyHost, strconv.Itoa(fw.proxyPort))
	fw.logger.LogAllowed(ip, proxyAddr)

	proxyConn, err := net.DialTimeout("tcp", proxyAddr, 5*time.Second)
	if err != nil {
		fw.logger.LogProxy(ip, fw.proxyHost, fw.proxyPort, "CONNECTION_FAILED")
		fw.logger.LogError("PROXY", "Cannot connect to reverse proxy %s - %v", proxyAddr, err)
		return
	}
	defer proxyConn.Close()

	fw.logger.LogProxy(ip, fw.proxyHost, fw.proxyPort, "CONNECTED")

	var wg sync.WaitGroup
	wg.Add(2)

	go fw.forwardData(conn, proxyConn, "client->proxy", &wg)
	go fw.forwardData(proxyConn, conn, "proxy->client", &wg)

	wg.Wait()
	fw.logger.LogConnection(ip, clientAddr.Port, "CLOSED")
}

func (fw *Firewall) Start() error {
	go fw.rulesWatcher()
	go fw.attemptsCleanupWatcher()

	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", fw.firewallPort))
	if err != nil {
		return fmt.Errorf("failed to listen on port %d: %v", fw.firewallPort, err)
	}
	defer listener.Close()

	fw.logger.LogStartup("Firewall listening on 0.0.0.0:%d -> proxy %s:%d", fw.firewallPort, fw.proxyHost, fw.proxyPort)

	for {
		conn, err := listener.Accept()
		if err != nil {
			fw.logger.LogError("FIREWALL", "Accept failed: %v", err)
			continue
		}

		go fw.handleConnection(conn)
	}
}

func main() {
	firewall := NewFirewall()
	defer firewall.logger.Close()

	if err := firewall.Start(); err != nil {
		firewall.logger.LogError("FIREWALL", "Failed to start: %v", err)
		log.Fatalf("[FIREWALL] Failed to start: %v", err)
	}
}
