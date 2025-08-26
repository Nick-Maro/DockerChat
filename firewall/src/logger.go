package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type LogLevel int

const (
	DEBUG LogLevel = iota
	INFO
	WARNING
	ERROR
	SECURITY
)

func (l LogLevel) String() string {
	switch l {
	case DEBUG:
		return "DEBUG"
	case INFO:
		return "INFO"
	case WARNING:
		return "WARNING"
	case ERROR:
		return "ERROR"
	case SECURITY:
		return "SECURITY"
	default:
		return "UNKNOWN"
	}
}

type FirewallLogger struct {
	mutex       sync.Mutex
	logFile     *os.File
	logger      *log.Logger
	logDir      string
	currentDate string
}

func NewFirewallLogger() (*FirewallLogger, error) {
	logDir := "/var/log/shared/firewall"

	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create logs directory: %v", err)
	}

	fl := &FirewallLogger{
		logDir: logDir,
	}

	if err := fl.initLogFile(); err != nil {
		return nil, err
	}

	return fl, nil
}

func (fl *FirewallLogger) initLogFile() error {
	fl.mutex.Lock()
	defer fl.mutex.Unlock()

	now := time.Now()
	dateStr := now.Format("2006-01-02")

	if fl.currentDate != dateStr {
		if fl.logFile != nil {
			fl.logFile.Close()
		}

		logFilePath := filepath.Join(fl.logDir, "firewall.log")

		// Se è un nuovo giorno e il file esiste, fai il backup
		if fl.currentDate != "" {
			backupPath := filepath.Join(fl.logDir, fmt.Sprintf("firewall-%s.log", fl.currentDate))
			os.Rename(logFilePath, backupPath)
		}

		var err error
		fl.logFile, err = os.OpenFile(logFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			return fmt.Errorf("failed to open log file %s: %v", logFilePath, err)
		}

		multiWriter := io.MultiWriter(os.Stdout, fl.logFile)
		fl.logger = log.New(multiWriter, "", 0)
		fl.currentDate = dateStr

		timestamp := time.Now().Format("2006-01-02 15:04:05.000")
		logEntry := fmt.Sprintf("[%s] [%s] [%s] Log file initialized: %s", timestamp, INFO.String(), "SYSTEM", logFilePath)
		fl.logger.Println(logEntry)
	}

	return nil
}

func (fl *FirewallLogger) writeLog(level LogLevel, category, format string, args ...interface{}) {
	fl.initLogFile()

	fl.mutex.Lock()
	defer fl.mutex.Unlock()

	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	message := fmt.Sprintf(format, args...)

	logEntry := fmt.Sprintf("[%s] [%s] [%s] %s", timestamp, level.String(), category, message)
	fl.logger.Println(logEntry)
}

func (fl *FirewallLogger) Close() {
	fl.mutex.Lock()
	defer fl.mutex.Unlock()

	if fl.logFile != nil {
		fl.logFile.Close()
	}
}

func (fl *FirewallLogger) LogStartup(message string, args ...interface{}) {
	fl.writeLog(INFO, "STARTUP", message, args...)
}

func (fl *FirewallLogger) LogConnection(ip string, port int, action string) {
	fl.writeLog(INFO, "CONNECTION", "IP: %s:%d - Action: %s", ip, port, action)
}

func (fl *FirewallLogger) LogBlocked(ip string, reason string, details ...interface{}) {
	message := fmt.Sprintf("IP: %s - Reason: %s", ip, reason)
	if len(details) > 0 {
		message += fmt.Sprintf(" - Details: %v", details)
	}
	fl.writeLog(SECURITY, "BLOCKED", message)
}

func (fl *FirewallLogger) LogAllowed(ip string, destination string) {
	fl.writeLog(INFO, "ALLOWED", "IP: %s -> Destination: %s", ip, destination)
}

func (fl *FirewallLogger) LogWhitelist(ip string) {
	fl.writeLog(INFO, "WHITELIST", "IP: %s allowed by whitelist", ip)
}

func (fl *FirewallLogger) LogRateLimit(ip string, attempts int, maxAttempts int) {
	fl.writeLog(SECURITY, "RATE_LIMIT", "IP: %s exceeded rate limit - Attempts: %d/%d", ip, attempts, maxAttempts)
}

func (fl *FirewallLogger) LogRulesReload(blockedIPs, whitelist int, allowedPorts []int, maxAttempts int) {
	fl.writeLog(INFO, "RULES", "Rules reloaded - Blocked IPs: %d, Whitelist: %d, Allowed Ports: %v, Max Attempts: %d",
		blockedIPs, whitelist, allowedPorts, maxAttempts)
}

func (fl *FirewallLogger) LogError(category, message string, args ...interface{}) {
	fl.writeLog(ERROR, category, message, args...)
}

func (fl *FirewallLogger) LogWarning(category, message string, args ...interface{}) {
	fl.writeLog(WARNING, category, message, args...)
}

func (fl *FirewallLogger) LogDebug(category, message string, args ...interface{}) {
	fl.writeLog(DEBUG, category, message, args...)
}

func (fl *FirewallLogger) LogProxy(ip, proxyHost string, proxyPort int, status string) {
	fl.writeLog(INFO, "PROXY", "IP: %s -> %s:%d - Status: %s", ip, proxyHost, proxyPort, status)
}

func (fl *FirewallLogger) LogCleanup(deletedEntries int) {
	fl.writeLog(DEBUG, "CLEANUP", "Cleaned up %d old connection attempts", deletedEntries)
}

func (fl *FirewallLogger) LogStats(totalConnections, blockedConnections, allowedConnections int) {
	fl.writeLog(INFO, "STATS", "Total: %d, Blocked: %d, Allowed: %d", totalConnections, blockedConnections, allowedConnections)
}
