package anomaly

import (
	"encoding/json"
	"io"
	"net/netip"
)

// AWSRanges answers one question: is this IP inside AWS, or out on the open
// internet?
//
// That single bit changes an alert's meaning completely. A Lambda function
// reaching a new AWS address is probably a developer adding an SDK call. The
// same function reaching a random address in a datacentre somewhere is the
// thing we built this tool to catch.
type AWSRanges struct {
	prefixes []netip.Prefix
	loaded   bool
}

// Loaded reports whether we have real range data. When false, callers must not
// claim an address is "outside AWS" - we simply do not know, and saying so
// would be inventing a fact.
func (r *AWSRanges) Loaded() bool { return r != nil && r.loaded }

// Contains reports whether ip falls inside any known AWS prefix.
func (r *AWSRanges) Contains(ip string) bool {
	if !r.Loaded() {
		return false
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}
	addr = addr.Unmap() // normalise ::ffff:1.2.3.4 to 1.2.3.4
	for _, p := range r.prefixes {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// awsIPRangesFile is the shape of https://ip-ranges.amazonaws.com/ip-ranges.json
type awsIPRangesFile struct {
	Prefixes []struct {
		IPPrefix string `json:"ip_prefix"`
	} `json:"prefixes"`
	IPv6Prefixes []struct {
		IPv6Prefix string `json:"ipv6_prefix"`
	} `json:"ipv6_prefixes"`
}

// LoadAWSRanges parses the official ip-ranges.json. Fetch it once at cold start
// and reuse it - it is a few megabytes and changes rarely.
func LoadAWSRanges(r io.Reader) (*AWSRanges, error) {
	var f awsIPRangesFile
	if err := json.NewDecoder(r).Decode(&f); err != nil {
		return nil, err
	}
	out := &AWSRanges{prefixes: make([]netip.Prefix, 0, len(f.Prefixes)+len(f.IPv6Prefixes))}
	for _, p := range f.Prefixes {
		if pre, err := netip.ParsePrefix(p.IPPrefix); err == nil {
			out.prefixes = append(out.prefixes, pre)
		}
	}
	for _, p := range f.IPv6Prefixes {
		if pre, err := netip.ParsePrefix(p.IPv6Prefix); err == nil {
			out.prefixes = append(out.prefixes, pre)
		}
	}
	out.loaded = len(out.prefixes) > 0
	return out, nil
}

// devAWSPrefixes is a COARSE, APPROXIMATE subset of Amazon's allocations, here
// so tests and local runs work with no network. It is deliberately not exact:
// production must call LoadAWSRanges with the real file. Treating this as
// authoritative would produce confidently wrong severities.
var devAWSPrefixes = []string{
	"3.0.0.0/8",
	"13.32.0.0/15",
	"15.177.0.0/18",
	"18.32.0.0/11",
	"18.64.0.0/10",
	"18.128.0.0/9",
	"34.192.0.0/10",
	"44.192.0.0/10",
	"52.0.0.0/11",
	"52.32.0.0/11",
	"52.64.0.0/12",
	"52.84.0.0/15",
	"52.92.0.0/14",
	"52.192.0.0/11",
	"54.64.0.0/11",
	"54.144.0.0/12",
	"54.160.0.0/11",
	"54.224.0.0/11",
	"54.239.0.0/16",
	"99.77.0.0/16",
	"107.20.0.0/14",
	"184.72.0.0/15",
	"204.236.0.0/15",
}

// DevAWSRanges returns the offline approximation described above.
func DevAWSRanges() *AWSRanges {
	out := &AWSRanges{prefixes: make([]netip.Prefix, 0, len(devAWSPrefixes))}
	for _, s := range devAWSPrefixes {
		if p, err := netip.ParsePrefix(s); err == nil {
			out.prefixes = append(out.prefixes, p)
		}
	}
	out.loaded = true
	return out
}
