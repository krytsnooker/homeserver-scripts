package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed public
var staticFS embed.FS

type pasteEntry struct {
	ID      int64  `json:"id"`
	Author  string `json:"author"`
	Content string `json:"content"`
	Date    string `json:"date"`
}

type server struct {
	mu       sync.Mutex
	stateDir string
}

func (s *server) pastesDir() string { return filepath.Join(s.stateDir, "pastes") }

func (s *server) ensureDirs() error { return os.MkdirAll(s.pastesDir(), 0755) }

func (s *server) nextID() int64 {
	entries, err := os.ReadDir(s.pastesDir())
	if err != nil {
		return 1
	}
	var maxID int64
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		id, err := strconv.ParseInt(strings.TrimSuffix(e.Name(), ".json"), 10, 64)
		if err == nil && id > maxID {
			maxID = id
		}
	}
	return maxID + 1
}

func (s *server) savePaste(author, content string) (pasteEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := pasteEntry{
		ID:      s.nextID(),
		Author:  author,
		Content: content,
		Date:    time.Now().UTC().Format(time.RFC3339),
	}
	data, err := json.Marshal(e)
	if err != nil {
		return pasteEntry{}, err
	}
	path := filepath.Join(s.pastesDir(), strconv.FormatInt(e.ID, 10)+".json")
	return e, os.WriteFile(path, data, 0644)
}

func (s *server) deletePaste(id int64) error {
	return os.Remove(filepath.Join(s.pastesDir(), strconv.FormatInt(id, 10)+".json"))
}

func (s *server) getPaste(id int64) (pasteEntry, error) {
	data, err := os.ReadFile(filepath.Join(s.pastesDir(), strconv.FormatInt(id, 10)+".json"))
	if err != nil {
		return pasteEntry{}, err
	}
	var e pasteEntry
	return e, json.Unmarshal(data, &e)
}

func (s *server) listPastes(userFilter string) []pasteEntry {
	entries, _ := os.ReadDir(s.pastesDir())
	var pastes []pasteEntry
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(s.pastesDir(), entry.Name()))
		if err != nil {
			continue
		}
		var p pasteEntry
		if json.Unmarshal(data, &p) != nil {
			continue
		}
		if userFilter != "" && p.Author != userFilter {
			continue
		}
		pastes = append(pastes, p)
	}
	sort.Slice(pastes, func(i, j int) bool { return pastes[i].ID > pastes[j].ID })
	return pastes
}

func (s *server) listUsers() []string {
	entries, _ := os.ReadDir(s.pastesDir())
	seen := map[string]struct{}{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(s.pastesDir(), entry.Name()))
		if err != nil {
			continue
		}
		var p pasteEntry
		if json.Unmarshal(data, &p) == nil && p.Author != "" {
			seen[p.Author] = struct{}{}
		}
	}
	users := make([]string, 0, len(seen))
	for u := range seen {
		users = append(users, u)
	}
	sort.Strings(users)
	return users
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func (s *server) handleListPastes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	pastes := s.listPastes(r.URL.Query().Get("user"))
	if pastes == nil {
		pastes = []pasteEntry{}
	}
	writeJSON(w, pastes)
}

func (s *server) handleCreatePaste(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Author  string `json:"author"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	author := strings.TrimSpace(req.Author)
	if author == "" {
		author = "Anonymous"
	}
	if len(author) > 100 {
		author = author[:100]
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		http.Error(w, "content required", http.StatusBadRequest)
		return
	}
	if len(content) > 100000 {
		http.Error(w, "content too large", http.StatusBadRequest)
		return
	}
	p, err := s.savePaste(author, content)
	if err != nil {
		log.Printf("savePaste: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, p)
}

func (s *server) handlePasteAPI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/paste/")

	if strings.HasSuffix(path, "/delete") {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		idStr := strings.TrimSuffix(path, "/delete")
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil || id <= 0 {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}
		err = s.deletePaste(id)
		if os.IsNotExist(err) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, err := strconv.ParseInt(path, 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	p, err := s.getPaste(id)
	if os.IsNotExist(err) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, p)
}

func (s *server) handleUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, s.listUsers())
}

func main() {
	port := os.Getenv("LAN_PASTEBIN_PORT")
	if port == "" {
		port = "5001"
	}
	stateDir := os.Getenv("LAN_PASTEBIN_STATE_DIR")
	if stateDir == "" {
		log.Fatal("LAN_PASTEBIN_STATE_DIR must be set")
	}

	s := &server{stateDir: stateDir}
	if err := s.ensureDirs(); err != nil {
		log.Fatalf("ensureDirs: %v", err)
	}

	publicFS, err := fs.Sub(staticFS, "public")
	if err != nil {
		log.Fatalf("sub fs: %v", err)
	}
	fileServer := http.FileServerFS(publicFS)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/pastes", s.handleListPastes)
	mux.HandleFunc("/api/paste", s.handleCreatePaste)
	mux.HandleFunc("/api/paste/", s.handlePasteAPI)
	mux.HandleFunc("/api/users", s.handleUsers)
	mux.HandleFunc("/paste/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, publicFS, "index.html")
	})
	mux.Handle("/", fileServer)

	srv := &http.Server{Addr: ":" + port, Handler: mux}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sig
		srv.Close()
	}()

	log.Printf("LAN Pastebin listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("listen: %v", err)
	}
}
