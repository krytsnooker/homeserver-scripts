package main

import (
	"bufio"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

//go:embed public
var publicFS embed.FS

type server struct {
	mu      sync.Mutex
	logFile string
}

// flexFloat accepts both JSON strings ("0.75") and numbers (0.75).
// The frontend sends accuracy as toFixed(2) which is a string.
type flexFloat float64

func (f *flexFloat) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return err
		}
		*f = flexFloat(v)
		return nil
	}
	var n float64
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	*f = flexFloat(n)
	return nil
}

type logEntry struct {
	Name     string    `json:"name"`
	Mode     string    `json:"mode"`
	Score    int       `json:"score"`
	Accuracy flexFloat `json:"accuracy"`
	Date     string    `json:"date"`
}

var validModes = map[string]bool{
	"addition": true, "subtraction": true,
	"multiplication": true, "division": true,
}

func (s *server) readAll() ([]logEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.Open(s.logFile)
	if os.IsNotExist(err) {
		return []logEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var entries []logEntry
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var e logEntry
		if json.Unmarshal([]byte(line), &e) == nil {
			entries = append(entries, e)
		}
	}
	if entries == nil {
		entries = []logEntry{}
	}
	return entries, sc.Err()
}

func (s *server) appendEntry(e logEntry) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.OpenFile(s.logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(b, '\n'))
	return err
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func (s *server) handleNames(w http.ResponseWriter, r *http.Request) {
	entries, err := s.readAll()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	seen := map[string]bool{}
	names := []string{}
	for _, e := range entries {
		if e.Name != "" && !seen[e.Name] {
			seen[e.Name] = true
			names = append(names, e.Name)
		}
	}
	writeJSON(w, names)
}

func (s *server) handleLogs(w http.ResponseWriter, r *http.Request) {
	entries, err := s.readAll()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, entries)
}

func (s *server) handleLog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var e logEntry
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	e.Name = strings.TrimSpace(e.Name)
	if e.Name == "" {
		e.Name = "Guest"
	}
	if len(e.Name) > 100 {
		http.Error(w, "name too long", http.StatusBadRequest)
		return
	}
	if !validModes[e.Mode] {
		http.Error(w, "invalid mode", http.StatusBadRequest)
		return
	}
	if e.Score < 0 {
		http.Error(w, "invalid score", http.StatusBadRequest)
		return
	}
	if err := s.appendEntry(e); err != nil {
		log.Printf("appendEntry: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func main() {
	port := os.Getenv("MATH_TUTOR_PORT")
	if port == "" {
		port = "3001"
	}
	stateDir := os.Getenv("MATH_TUTOR_STATE_DIR")
	if stateDir == "" {
		stateDir = "."
	}

	srv := &server{logFile: filepath.Join(stateDir, "logs.jsonl")}

	sub, err := fs.Sub(publicFS, "public")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	mux.HandleFunc("/api/names", srv.handleNames)
	mux.HandleFunc("/api/logs", srv.handleLogs)
	mux.HandleFunc("/api/log", srv.handleLog)

	httpSrv := &http.Server{Addr: ":" + port, Handler: mux}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
		<-sig
		httpSrv.Close()
	}()

	log.Printf("Math Tutor listening on :%s", port)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
