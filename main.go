package main

import (
	"compress/gzip"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed static
var staticFiles embed.FS

var gzipExts = map[string]bool{
	".html": true, ".js": true, ".css": true, ".json": true, ".svg": true,
	".txt": true, ".geojson": true, ".map": true, ".wasm": true,
}

func canGzip(r *http.Request, p string) bool {
	if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		return false
	}
	if p == "" || p == "/" {
		return true
	}
	i := strings.LastIndex(p, ".")
	return i >= 0 && gzipExts[strings.ToLower(p[i:])]
}

type gzipResponseWriter struct {
	http.ResponseWriter
	w        io.Writer
	stripped bool
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	g.ResponseWriter.Header().Del("Content-Length")
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.stripped {
		g.ResponseWriter.Header().Del("Content-Length")
		g.stripped = true
	}
	return g.w.Write(b)
}

var epoch = time.Now()

func nowMs() float64 { return float64(time.Since(epoch).Microseconds()) / 1000 }

type Client struct {
	id     string
	name   string
	color  string
	car    string
	joined int
	conn   *websocket.Conn
	send   chan []byte
	state  json.RawMessage
	bounty int
	fin    float64
}

type Hub struct {
	mu      sync.Mutex
	clients map[string]*Client
	nextID  int
	hostID  string
	phase   string // lobby | race | results
	mode    string // race | pursuit
	laps    int
	traffic bool
	mapID   string
	startAt float64
	seed    int
	grid    map[string]int
	results []map[string]any
}

func newHub() *Hub {
	return &Hub{clients: map[string]*Client{}, phase: "lobby", mode: "race", laps: 3, traffic: true, mapID: "bengaluru"}
}

func (h *Hub) sendTo(c *Client, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case c.send <- b:
	default:
	}
}

func (h *Hub) broadcast(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	for _, c := range h.clients {
		select {
		case c.send <- b:
		default:
		}
	}
}

func (h *Hub) sortedClients() []*Client {
	cs := make([]*Client, 0, len(h.clients))
	for _, c := range h.clients {
		cs = append(cs, c)
	}
	sort.Slice(cs, func(i, j int) bool { return cs[i].joined < cs[j].joined })
	return cs
}

func (h *Hub) lobbyMsg() map[string]any {
	ps := []map[string]any{}
	for _, c := range h.sortedClients() {
		ps = append(ps, map[string]any{"id": c.id, "name": c.name, "color": c.color, "car": c.car})
	}
	return map[string]any{"t": "lobby", "players": ps, "host": h.hostID, "phase": h.phase,
		"mode": h.mode, "laps": h.laps, "traffic": h.traffic, "map": h.mapID}
}

func (h *Hub) startMsg() map[string]any {
	return map[string]any{"t": "start", "mode": h.mode, "laps": h.laps, "traffic": h.traffic, "map": h.mapID,
		"startAt": h.startAt, "grid": h.grid, "seed": h.seed}
}

func (h *Hub) startRace() {
	h.phase = "race"
	h.startAt = nowMs() + 4500
	h.seed = int(time.Now().UnixNano() % 100000)
	h.grid = map[string]int{}
	h.results = nil
	for i, c := range h.sortedClients() {
		h.grid[c.id] = i
		c.fin = 0
		c.bounty = 0
		c.state = nil
	}
	h.broadcast(h.startMsg())
	h.broadcast(h.lobbyMsg())
}

func (h *Hub) finishRace() {
	if h.phase != "race" {
		return
	}
	h.phase = "results"
	cs := h.sortedClients()
	if h.mode == "race" {
		sort.SliceStable(cs, func(i, j int) bool {
			a, b := cs[i].fin, cs[j].fin
			if a == 0 {
				return false
			}
			return b == 0 || a < b
		})
	} else {
		sort.SliceStable(cs, func(i, j int) bool { return cs[i].bounty > cs[j].bounty })
	}
	h.results = []map[string]any{}
	for _, c := range cs {
		h.results = append(h.results, map[string]any{"id": c.id, "name": c.name, "color": c.color, "time": c.fin, "bounty": c.bounty})
	}
	h.broadcast(map[string]any{"t": "result", "mode": h.mode, "order": h.results})
	h.broadcast(h.lobbyMsg())
}

func (h *Hub) checkAllFinished() {
	if h.mode != "race" || h.phase != "race" {
		return
	}
	done := 0
	for _, c := range h.clients {
		if c.fin > 0 {
			done++
		}
	}
	if done == len(h.clients) {
		h.finishRace()
		return
	}
	if done == 1 {
		seed := h.seed
		go func() {
			time.Sleep(30 * time.Second)
			h.mu.Lock()
			defer h.mu.Unlock()
			if h.phase == "race" && h.seed == seed {
				h.finishRace()
			}
		}()
	}
}

type inMsg struct {
	T       string          `json:"t"`
	Name    string          `json:"name"`
	Color   string          `json:"color"`
	Car     string          `json:"car"`
	Map     string          `json:"map"`
	Mode    string          `json:"mode"`
	Laps    int             `json:"laps"`
	Traffic *bool           `json:"traffic"`
	C       float64         `json:"c"`
	Time    float64         `json:"time"`
	S       json.RawMessage `json:"s"`
	K       json.RawMessage `json:"k"`
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func (h *Hub) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	h.mu.Lock()
	h.nextID++
	c := &Client{id: fmt.Sprintf("p%d", h.nextID), name: fmt.Sprintf("Racer %d", h.nextID), color: "#c00000", car: "ferrari",
		joined: h.nextID, conn: conn, send: make(chan []byte, 128)}
	h.clients[c.id] = c
	if h.hostID == "" {
		h.hostID = c.id
	}
	h.sendTo(c, map[string]any{"t": "welcome", "id": c.id, "now": nowMs()})
	if h.phase == "race" {
		h.grid[c.id] = len(h.grid)
		h.sendTo(c, h.startMsg())
	}
	h.broadcast(h.lobbyMsg())
	h.mu.Unlock()

	go func() {
		for b := range c.send {
			conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
				conn.Close()
				return
			}
		}
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var m inMsg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		h.handle(c, &m)
	}

	h.mu.Lock()
	delete(h.clients, c.id)
	close(c.send)
	if h.hostID == c.id {
		h.hostID = ""
		if cs := h.sortedClients(); len(cs) > 0 {
			h.hostID = cs[0].id
		}
	}
	if len(h.clients) == 0 {
		h.phase = "lobby"
	} else {
		h.checkAllFinished()
	}
	h.broadcast(map[string]any{"t": "leave", "id": c.id})
	h.broadcast(h.lobbyMsg())
	h.mu.Unlock()
	conn.Close()
}

func (h *Hub) handle(c *Client, m *inMsg) {
	h.mu.Lock()
	defer h.mu.Unlock()
	isHost := c.id == h.hostID
	switch m.T {
	case "ping":
		h.sendTo(c, map[string]any{"t": "pong", "c": m.C, "now": nowMs()})
	case "hello":
		if n := strings.TrimSpace(m.Name); n != "" {
			if len(n) > 16 {
				n = n[:16]
			}
			c.name = n
		}
		if len(m.Color) == 7 && m.Color[0] == '#' {
			c.color = m.Color
		}
		if m.Car != "" && len(m.Car) <= 16 {
			c.car = m.Car
		}
		h.broadcast(h.lobbyMsg())
	case "cfg":
		if !isHost || h.phase == "race" {
			return
		}
		if m.Mode == "race" || m.Mode == "pursuit" {
			h.mode = m.Mode
		}
		if m.Laps >= 1 && m.Laps <= 10 {
			h.laps = m.Laps
		}
		if m.Traffic != nil {
			h.traffic = *m.Traffic
		}
		if validID(m.Map) {
			h.mapID = m.Map
		}
		h.broadcast(h.lobbyMsg())
	case "start":
		if isHost && h.phase != "race" {
			h.startRace()
		}
	case "end":
		if isHost {
			if h.phase == "race" {
				h.finishRace()
			} else {
				h.phase = "lobby"
				h.broadcast(h.lobbyMsg())
			}
		}
	case "s":
		c.state = m.S
		var s struct {
			B int `json:"b"`
		}
		if json.Unmarshal(m.S, &s) == nil {
			c.bounty = s.B
		}
	case "knock":
		b, _ := json.Marshal(map[string]any{"t": "knock", "k": m.K})
		for id, o := range h.clients {
			if id != c.id {
				select {
				case o.send <- b:
				default:
				}
			}
		}
	case "fin":
		if h.phase == "race" && c.fin == 0 && m.Time > 0 {
			c.fin = m.Time
			h.broadcast(map[string]any{"t": "fin", "id": c.id, "time": m.Time})
			h.checkAllFinished()
		}
	}
}

func (h *Hub) snapshotLoop() {
	t := time.NewTicker(50 * time.Millisecond)
	for range t.C {
		h.mu.Lock()
		if len(h.clients) > 0 {
			ps := make([]map[string]any, 0, len(h.clients))
			for _, c := range h.clients {
				if c.state != nil {
					ps = append(ps, map[string]any{"id": c.id, "s": c.state})
				}
			}
			h.broadcast(map[string]any{"t": "snap", "now": nowMs(), "p": ps})
		}
		h.mu.Unlock()
	}
}

func validID(s string) bool {
	if s == "" || len(s) > 24 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}

// Physical NICs (Ethernet, Wi-Fi) have a backing device in sysfs; VPNs, Tailscale, WireGuard, Docker bridges don't.
func isPhysical(name string) bool {
	_, err := os.Stat("/sys/class/net/" + name + "/device")
	return err == nil
}

func lanIPs() []string {
	var out []string
	ifaces, _ := net.Interfaces()
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 || !isPhysical(i.Name) {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil {
				out = append(out, ipn.IP.String())
			}
		}
	}
	return out
}

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	flag.Parse()

	h := newHub()
	go h.snapshotLoop()

	sub, _ := fs.Sub(staticFiles, "static")
	files := http.FileServer(http.FS(sub))
	http.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Long cache for immutable asset dirs; no-cache for everything else so the shell stays fresh.
		p := r.URL.Path
		dir, _ := path.Split(p)
		if strings.HasPrefix(dir, "/models/") || strings.HasPrefix(dir, "/fonts/") ||
			strings.HasPrefix(dir, "/vendor/") || strings.HasPrefix(dir, "/sfx/") ||
			strings.HasPrefix(dir, "/maps/") || strings.HasPrefix(dir, "/photos/") {
			w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if canGzip(r, p) {
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Add("Vary", "Accept-Encoding")
			gz := gzip.NewWriter(w)
			defer gz.Close()
			files.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, w: gz}, r)
			return
		}
		files.ServeHTTP(w, r)
	}))
	http.HandleFunc("/ws", h.serveWS)

	host, port, _ := net.SplitHostPort(*addr)
	fmt.Println("LAN RACER 3D — LAN racing server")
	fmt.Printf("  this machine:  http://localhost:%s\n", port)
	if host != "" { // explicit address: listen exactly there
		log.Fatal(http.ListenAndServe(*addr, nil))
	}
	// Default: only localhost and the physical LAN cards, never VPN/WireGuard/Tailscale/Docker interfaces.
	errs := make(chan error)
	for _, ip := range append([]string{"127.0.0.1", "::1"}, lanIPs()...) {
		ln, err := net.Listen("tcp", net.JoinHostPort(ip, port))
		if err != nil {
			if ip == "::1" {
				continue // no IPv6 loopback
			}
			log.Fatal(err)
		}
		if ip != "127.0.0.1" && ip != "::1" {
			fmt.Printf("  LAN players:   http://%s:%s\n", ip, port)
		}
		go func() { errs <- http.Serve(ln, nil) }()
	}
	log.Fatal(<-errs)
}
