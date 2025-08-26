package main

import (
	"net"
	"strings"
)

type ParsedRules struct {
	BlockedIPs           []*net.IPNet
	Whitelist            []*net.IPNet
	AllowedPorts         []int
	MaxAttemptsPerMinute int
}

type IPMatcher struct {
	networks []*net.IPNet
}

func NewIPMatcher(ipStrings []string) *IPMatcher {
	matcher := &IPMatcher{
		networks: make([]*net.IPNet, 0, len(ipStrings)),
	}

	for _, ipStr := range ipStrings {
		ipStr = strings.TrimSpace(ipStr)
		if ipStr == "" {
			continue
		}

		var ipNet *net.IPNet
		var err error

		if strings.Contains(ipStr, "/") {
			_, ipNet, err = net.ParseCIDR(ipStr)
		} else {
			ip := net.ParseIP(ipStr)
			if ip != nil {
				if ip.To4() != nil {
					_, ipNet, _ = net.ParseCIDR(ip.String() + "/32")
				} else {
					_, ipNet, _ = net.ParseCIDR(ip.String() + "/128")
				}
			}
		}

		if err == nil && ipNet != nil {
			matcher.networks = append(matcher.networks, ipNet)
		}
	}

	return matcher
}

func (m *IPMatcher) Contains(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}

	for _, network := range m.networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func (m *IPMatcher) Size() int {
	return len(m.networks)
}

func ParseRules(rules *Rules) *ParsedRules {
	return &ParsedRules{
		BlockedIPs:           NewIPMatcher(rules.BlockedIPs).networks,
		Whitelist:            NewIPMatcher(rules.Whitelist).networks,
		AllowedPorts:         rules.AllowedPorts,
		MaxAttemptsPerMinute: rules.MaxAttemptsPerMinute,
	}
}

func (pr *ParsedRules) IsWhitelisted(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}

	for _, network := range pr.Whitelist {
		if network.Contains(parsed) {
			return true
		}
	}
	return false
}

func (pr *ParsedRules) IsBlocked(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}

	for _, network := range pr.BlockedIPs {
		if network.Contains(parsed) {
			return true
		}
	}
	return false
}

func (pr *ParsedRules) IsAllowedPort(port int) bool {
	if len(pr.AllowedPorts) == 0 {
		return true
	}

	for _, allowedPort := range pr.AllowedPorts {
		if port == allowedPort {
			return true
		}
	}
	return false
}
