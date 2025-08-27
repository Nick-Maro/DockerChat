package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
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
	LogSpamInterval       = 1 * time.Minute
	MaxConcurrentConns    = 1000
	ConnectionTimeout     = 30 * time.Second
	ProxyConnectTimeout   = 10 * time.Second
)

type Rules struct {
	BlockedIPs           []string `json:"blocked_ips"`
	Whitelist            []string `json:"whitelist"`
	AllowedPorts         []int    `json:"allowed_ports"`
	MaxAttemptsPerMinute int      `json:"max_attempts_per_minute"`
}

type Firewall struct {
	rules              *Rules
	parsedRules        *ParsedRules
	rulesMutex         sync.RWMutex
	rulesFile          string
	rulesModTime       time.Time
	connectionAttempts map[string][]time.Time
	attemptsMutex      sync.RWMutex
	logger             *FirewallLogger

	firewallPort int
	proxyHost    string
	proxyPort    int

	lastErrorLog  map[string]time.Time
	errorLogMutex sync.RWMutex

	shutdown    chan bool
	listener    net.Listener
	activeConns sync.WaitGroup
	connCounter int64
	connMutex   sync.RWMutex
}

func NewFirewall() *Firewall {
	fw := &Firewall{
		rulesFile:          "/var/log/shared/firewall/rules.json",
		connectionAttempts: make(map[string][]time.Time),
		firewallPort:       getEnvInt("FIREWALL_PORT", DefaultFirewallPort),
		proxyHost:          getEnv("REVERSE_PROXY_IP", "reverse-proxy"),
		proxyPort:          getEnvInt("REVERSE_PROXY_PORT", DefaultProxyPort),
		lastErrorLog:       make(map[string]time.Time),
		shutdown:           make(chan bool),
	}

	logger, err := NewFirewallLogger()
	if err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}
	fw.logger = logger

	fw.loadRules()

	if err := fw.validateConfiguration(); err != nil {
		log.Fatalf("Configuration validation failed: %v", err)
	}

	fw.logger.LogStartup("Firewall initialized - Port: %d, Proxy: %s:%d", fw.firewallPort, fw.proxyHost, fw.proxyPort)
	return fw
}

func (fw *Firewall) validateConfiguration() error {
	if fw.firewallPort <= 0 || fw.firewallPort > 65535 {
		return fmt.Errorf("invalid firewall port: %d", fw.firewallPort)
	}

	if fw.proxyPort <= 0 || fw.proxyPort > 65535 {
		return fmt.Errorf("invalid proxy port: %d", fw.proxyPort)
	}

	if fw.proxyHost == "" {
		return fmt.Errorf("proxy host cannot be empty")
	}

	proxyAddr := net.JoinHostPort(fw.proxyHost, strconv.Itoa(fw.proxyPort))
	conn, err := net.DialTimeout("tcp", proxyAddr, 3*time.Second)
	if err != nil {
		fw.logger.LogWarning("STARTUP", "Cannot reach proxy %s: %v", proxyAddr, err)
	} else {
		conn.Close()
		fw.logger.LogStartup("Proxy connectivity verified: %s", proxyAddr)
	}

	return nil
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

func (fw *Firewall) logErrorRateLimited(key, category, msg string, args ...interface{}) {
	fw.errorLogMutex.Lock()
	defer fw.errorLogMutex.Unlock()

	now := time.Now()
	if lastLog, exists := fw.lastErrorLog[key]; exists {
		if now.Sub(lastLog) < LogSpamInterval {
			return
		}
	}

	fw.lastErrorLog[key] = now
	if fw.logger != nil {
		fw.logger.LogError(category, msg, args...)
	}
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
			fw.parsedRules = ParseRules(fw.rules)
			if fw.logger != nil {
				fw.logger.LogWarning("RULES", "Using default rules (file not found), but NOT overwriting existing file: %s", fw.rulesFile)
			}
			// Don't save default rules to file - preserve user's file
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
		fw.logErrorRateLimited("rules_read", "RULES", "Failed to read rules file: %v", err)
		return
	}

	var tempRules Rules
	if err := json.Unmarshal(data, &tempRules); err != nil {
		fw.logErrorRateLimited("rules_parse", "RULES", "Failed to parse rules JSON: %v - keeping current rules", err)
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
	fw.parsedRules = ParseRules(&tempRules)
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

	if fw.parsedRules != nil {
		return fw.parsedRules.IsWhitelisted(ip)
	}
	return false
}

func (fw *Firewall) isBlocked(ip string) bool {
	fw.rulesMutex.RLock()
	defer fw.rulesMutex.RUnlock()

	if fw.parsedRules != nil {
		return fw.parsedRules.IsBlocked(ip)
	}
	return false
}

func (fw *Firewall) isAllowedPort(port int) bool {
	fw.rulesMutex.RLock()
	defer fw.rulesMutex.RUnlock()

	if fw.parsedRules != nil {
		return fw.parsedRules.IsAllowedPort(port)
	}
	return true
}

// extractRequestedPort reads the HTTP request and extracts the port from Host header
func (fw *Firewall) extractRequestedPort(conn net.Conn) (int, []byte, error) {
	// Set a short timeout for reading the request
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer conn.SetReadDeadline(time.Time{}) // Reset deadline

	reader := bufio.NewReader(conn)

	// Read the first line (request line)
	firstLine, err := reader.ReadString('\n')
	if err != nil {
		return 0, nil, err
	}

	// Buffer to store the complete request
	var requestBuffer []byte
	requestBuffer = append(requestBuffer, []byte(firstLine)...)

	// Read headers
	var hostHeader string
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return 0, nil, err
		}
		requestBuffer = append(requestBuffer, []byte(line)...)

		// Check for Host header
		if strings.HasPrefix(strings.ToLower(line), "host:") {
			hostHeader = strings.TrimSpace(line[5:])
		}

		// End of headers
		if line == "\r\n" || line == "\n" {
			break
		}
	}

	// Extract port from host header
	port := 80 // default
	if hostHeader != "" {
		if strings.Contains(hostHeader, ":") {
			parts := strings.Split(hostHeader, ":")
			if len(parts) >= 2 {
				if p, err := strconv.Atoi(parts[len(parts)-1]); err == nil {
					port = p
				}
			}
		}
	}

	return port, requestBuffer, nil
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

	src.SetReadDeadline(time.Now().Add(ConnectionTimeout))
	dst.SetWriteDeadline(time.Now().Add(ConnectionTimeout))

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
	defer fw.activeConns.Done()

	fw.connMutex.Lock()
	currentConns := fw.connCounter
	if currentConns >= MaxConcurrentConns {
		fw.connMutex.Unlock()
		fw.logger.LogError("FIREWALL", "Max concurrent connections reached (%d), dropping connection", MaxConcurrentConns)
		return
	}
	fw.connCounter++
	fw.connMutex.Unlock()

	defer func() {
		fw.connMutex.Lock()
		fw.connCounter--
		fw.connMutex.Unlock()
	}()

	conn.SetDeadline(time.Now().Add(ConnectionTimeout))

	clientAddr := conn.RemoteAddr().(*net.TCPAddr)
	ip := clientAddr.IP.String()

	fw.logger.LogConnection(ip, clientAddr.Port, "INCOMING")
	fw.logger.LogError("DEBUG", "Starting connection handling for IP: %s", ip)

	// Extract requested port from HTTP request
	requestedPort, requestBuffer, err := fw.extractRequestedPort(conn)
	if err != nil {
		fw.logger.LogError("FIREWALL", "Failed to parse HTTP request from %s: %v", ip, err)
		return
	}

	fw.logger.LogError("DEBUG", "Extracted port %d from request by IP %s", requestedPort, ip)

	if fw.isWhitelisted(ip) {
		fw.logger.LogWhitelist(ip)
	} else {
		if fw.isBlocked(ip) {
			fw.logger.LogBlocked(ip, "blocked by configuration")
			return
		}

		if !fw.isAllowedPort(requestedPort) {
			fw.logger.LogBlocked(ip, "requested port not allowed", requestedPort)
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

	proxyConn, err := net.DialTimeout("tcp", proxyAddr, ProxyConnectTimeout)
	if err != nil {
		fw.logger.LogProxy(ip, fw.proxyHost, fw.proxyPort, "CONNECTION_FAILED")
		fw.logger.LogError("PROXY", "Cannot connect to reverse proxy %s - %v", proxyAddr, err)
		return
	}
	defer proxyConn.Close()

	fw.logger.LogProxy(ip, fw.proxyHost, fw.proxyPort, "CONNECTED")

	// Forward the buffered request first
	_, err = proxyConn.Write(requestBuffer)
	if err != nil {
		fw.logger.LogError("PROXY", "Failed to forward request buffer: %v", err)
		return
	}

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
	fw.listener = listener

	fw.logger.LogStartup("Firewall listening on 0.0.0.0:%d -> proxy %s:%d", fw.firewallPort, fw.proxyHost, fw.proxyPort)

	go fw.handleSignals()

	for {
		select {
		case <-fw.shutdown:
			fw.logger.LogStartup("Shutdown signal received, stopping firewall...")
			listener.Close()
			fw.logger.LogStartup("Waiting for active connections to finish...")
			fw.activeConns.Wait()
			fw.logger.LogStartup("Firewall stopped gracefully")
			return nil
		default:
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-fw.shutdown:
					return nil
				default:
					fw.logger.LogError("FIREWALL", "Accept failed: %v", err)
					continue
				}
			}

			fw.activeConns.Add(1)
			go fw.handleConnection(conn)
		}
	}
}

func (fw *Firewall) handleSignals() {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigChan
	fw.logger.LogStartup("Received signal: %v", sig)
	close(fw.shutdown)
}

func main() {
	firewall := NewFirewall()
	defer firewall.logger.Close()

	if err := firewall.Start(); err != nil {
		firewall.logger.LogError("FIREWALL", "Failed to start: %v", err)
		log.Fatalf("[FIREWALL] Failed to start: %v", err)
	}
}
